#!/usr/bin/env node
// PreToolUse hook (Claude Code): blocks a migration that creates a table without
// enabling AND forcing row level security in the same file.
//
// Rule: docs/data-isolation.md, sections 3 and 5 — every table is created in the
// same migration as its row security; "add RLS later" is not allowed. The `auth`
// schema is exempt: starter_app has no privileges there at all (section 3).
//
// Recognised: `create [global|local] [temp|temporary|unlogged] table [if not
// exists] <name>` (also `... as select` and `partition of`), `select ... into
// [temp|unlogged] [table] <name>`, quoted names (`"Notes"`, `public."notes"`).
// A migration that disables RLS or drops FORCE (`disable row level security`,
// `no force row level security`) is blocked as well. Migrations may be `.ts`,
// `.mts`, `.cts`, `.js`, `.mjs` or `.cjs`. SQL and JS comments are removed
// first (stripComments), so a commented-out statement neither creates a table
// nor counts as row security.
//
// The hook reads the text of one file; it is the early warning. The proof is
// the integration test tests/integration/rls-coverage.test.ts, which checks
// every table after all migrations.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the Write/Edit and shows the reason to the agent; exit 0 lets
// it through. A malformed event exits 1 (a hook bug, reported but not blocking).
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MIGRATION_FILE =
  /(^|[\\/])src[\\/]lib[\\/]db[\\/]migrations[\\/][^\\/]+\.(?:ts|mts|cts|js|mjs|cjs)$/;
// One identifier, plain or in double quotes, optionally schema-qualified.
const IDENTIFIER = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)`;
const NAME = String.raw`${IDENTIFIER}(?:\s*\.\s*${IDENTIFIER})?`;
const TABLE_KIND = String.raw`(?:(?:global|local)\s+)?(?:(?:temporary|temp|unlogged)\s+)?`;
const CREATE_TABLE = new RegExp(
  String.raw`\bcreate\s+${TABLE_KIND}table\s+(?:if\s+not\s+exists\s+)?(${NAME})`,
  "gi",
);
// `select <columns> into <new table>` (before any `from`): it creates a table.
const SELECT_INTO = new RegExp(
  String.raw`\bselect\b(?:(?!\bfrom\b|\bselect\b|;)[\s\S])*?\binto\s+(?!strict\b)${TABLE_KIND}(?:table\s+)?(${NAME})`,
  "gi",
);
const WEAKEN_RLS = new RegExp(
  String.raw`\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${NAME})\s+(?:disable|no\s+force)\s+row\s+level\s+security`,
  "gi",
);
const EXEMPT_SCHEMAS = new Set(["auth"]);

export function isMigrationFile(filePath) {
  return typeof filePath === "string" && MIGRATION_FILE.test(filePath);
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `"Public" . "Notes"` -> `public.notes`; a bare name gets the `public` schema. */
function qualify(name) {
  const parts = name.split(/\s*\.\s*/).map((part) => part.replace(/^"|"$/g, "").toLowerCase());

  return parts.length === 2 ? parts : ["public", parts[0]];
}

/** The table as reported: bare in `public`, qualified elsewhere; null when exempt. */
function reportedName(rawName) {
  const [schema, name] = qualify(rawName);
  if (EXEMPT_SCHEMAS.has(schema)) return null;
  return schema === "public" ? name : `${schema}.${name}`;
}

/** A pattern for the table name in SQL text: optional quotes, optional `public.`. */
function namePattern(table) {
  const part = (value) => `"?${escape(value)}"?`;
  const [schema, name] = table.includes(".") ? table.split(".", 2) : [null, table];

  return schema === null
    ? `(?:"?public"?\\s*\\.\\s*)?${part(name)}`
    : `${part(schema)}\\s*\\.\\s*${part(name)}`;
}

// `--` starts a SQL comment only after whitespace, `;`, `(` or `,` (not in
// `i--` or `'a--b'`).
const SQL_COMMENT_START = /[\s;(,]/;

/**
 * A `-- ` comment in plain SQL text (outside any JS string): it is the first
 * thing on its line or follows a `;`, and is followed by a space or the end of
 * the line. JS `i--` or `--i` is neither.
 */
function startsSqlLineComment(source, i) {
  const after = source[i + 2];
  if (after !== undefined && !/\s/.test(after)) return false;

  const before = source.slice(source.lastIndexOf("\n", i - 1) + 1, i);
  return /^\s*$/.test(before) || /;\s*$/.test(before);
}

/** The index after the SQL block comment starting at `i`, or -1 when it does not close before `limit`. */
function skipBlockComment(source, i, limit) {
  const end = source.indexOf("*/", i + 2);

  return end === -1 || (limit !== -1 && end > limit) ? -1 : end + 2;
}

/**
 * The source without JS and SQL comments (they become a space or nothing), so
 * a statement in a comment neither creates a table nor counts as row security.
 * One left-to-right pass that knows JS strings and template literals: `//` and
 * `/* *\/` are JS comments in code, `--` and `/* *\/` are SQL comments inside a
 * template literal (until the end of the line) or a quoted string (until its
 * closing quote). Comment markers inside a string never open a JS comment.
 */
export function stripComments(source) {
  let out = "";
  // Modes: code, sq, dq, tpl. `${` inside a template re-enters code; `}` leaves it.
  let mode = "code";
  let depth = 0;
  const saved = [];

  for (let i = 0; i < source.length;) {
    const char = source[i];
    const next = source[i + 1];

    if (mode === "code") {
      if (char === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        out += " ";
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (
        (char === "/" && next === "/") ||
        (char === "-" && next === "-" && startsSqlLineComment(source, i))
      ) {
        const end = source.indexOf("\n", i);
        i = end === -1 ? source.length : end;
        continue;
      }
      if (char === "'") mode = "sq";
      else if (char === '"') mode = "dq";
      else if (char === "`") mode = "tpl";
      else if (char === "{") depth += 1;
      else if (char === "}") {
        if (depth === 0 && saved.length > 0) {
          ({ depth } = saved.pop());
          mode = "tpl";
        } else depth = Math.max(0, depth - 1);
      }
      out += char;
      i += 1;
      continue;
    }

    if (char === "\\") {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (mode === "tpl" && char === "`") mode = "code";
    else if (mode === "sq" && char === "'") mode = "code";
    else if (mode === "dq" && char === '"') mode = "code";
    else if (mode === "tpl" && char === "$" && next === "{") {
      saved.push({ depth });
      depth = 0;
      mode = "code";
      out += "${";
      i += 2;
      continue;
    } else if (char === "-" && next === "-" && (i === 0 || SQL_COMMENT_START.test(source[i - 1]))) {
      // Up to the end of the line, the closing quote or backtick, or `${`.
      let end = i + 2;
      while (end < source.length) {
        const c = source[end];
        if (c === "\n") break;
        if (c === "\\") {
          end += 2;
          continue;
        }
        if (
          (mode === "tpl" && (c === "`" || (c === "$" && source[end + 1] === "{"))) ||
          (mode === "sq" && c === "'") ||
          (mode === "dq" && c === '"')
        )
          break;
        end += 1;
      }
      out += " ";
      i = end;
      continue;
    } else if (char === "/" && next === "*") {
      const quote = mode === "tpl" ? "`" : mode === "sq" ? "'" : '"';
      const limit = source.indexOf(quote, i + 2);
      const after = skipBlockComment(source, i, limit);

      if (after !== -1) {
        out += " ";
        i = after;
        continue;
      }
    }
    out += char;
    i += 1;
  }
  return out;
}

function hasRowSecurity(source, table) {
  const name = namePattern(table);
  const quoted = (pattern) => `["'\`]${pattern}["'\`]`;

  // privateTableSecuritySql() from src/lib/db/policies.ts enables and forces RLS.
  if (new RegExp(`privateTableSecuritySql\\(\\s*${quoted(name)}`, "i").test(source)) {
    return true;
  }

  const literal = (mode) =>
    new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${name}\\s+${mode}\\s+row\\s+level\\s+security`,
      "i",
    );
  if (literal("enable").test(source) && literal("force").test(source)) {
    return true;
  }

  // A loop over a list of names: `alter table ${table} enable row level security`.
  const templated = (mode) =>
    new RegExp(`alter\\s+table\\s+\\$\\{[^}]+\\}\\s+${mode}\\s+row\\s+level\\s+security`, "i");

  return (
    templated("enable").test(source) &&
    templated("force").test(source) &&
    new RegExp(quoted(name), "i").test(source)
  );
}

/** Tables created in `source` that do not get ENABLE + FORCE row level security. */
export function findTablesWithoutRls(rawSource) {
  const source = stripComments(rawSource);
  const tables = new Set();

  for (const pattern of [CREATE_TABLE, SELECT_INTO]) {
    for (const match of source.matchAll(pattern)) {
      const table = reportedName(match[1]);
      if (table !== null) tables.add(table);
    }
  }

  return [...tables].filter((table) => !hasRowSecurity(source, table));
}

/** Tables whose row level security `source` switches off or stops forcing. */
export function findWeakenedRls(rawSource) {
  const source = stripComments(rawSource);
  const tables = new Set();

  for (const match of source.matchAll(WEAKEN_RLS)) {
    const table = reportedName(match[1]);
    if (table !== null) tables.add(table);
  }
  return [...tables];
}

function replace(content, oldString, newString, replaceAll) {
  if (typeof oldString !== "string" || typeof newString !== "string") return null;
  if (!content.includes(oldString)) return null;

  return replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, () => newString);
}

/** The file content after the tool call, or null when it cannot be known. */
export function contentAfter(toolName, input) {
  if (toolName === "Write") {
    return typeof input.content === "string" ? input.content : null;
  }

  const current = existsSync(input.file_path) ? readFileSync(input.file_path, "utf8") : "";

  if (toolName === "Edit") {
    return replace(current, input.old_string, input.new_string, input.replace_all === true);
  }
  if (toolName === "MultiEdit" && Array.isArray(input.edits)) {
    let next = current;
    for (const edit of input.edits) {
      next = replace(next, edit.old_string, edit.new_string, edit.replace_all === true);
      if (next === null) return null;
    }
    return next;
  }

  return null;
}

export const SKILL_HINT =
  "Wzorzec krok po kroku: skill private-data (.claude/skills/private-data/SKILL.md).";

export function blockMessage(filePath, tables, weakened = []) {
  const lines = [`Zablokowano zapis migracji ${filePath}.`];

  if (tables.length > 0) {
    lines.push(
      `Tabela bez włączonego i wymuszonego RLS w tej samej migracji: ${tables.join(", ")}.`,
      "Dodaj privateTableSecuritySql(...) z src/lib/db/policies.ts (dane prywatne właściciela)",
      "albo `alter table <tabela> enable row level security` i `force row level security` z politykami.",
    );
  }
  if (weakened.length > 0) {
    lines.push(
      `Migracja wyłącza RLS albo zdejmuje FORCE: ${weakened.join(", ")}. Takiej zmiany agent nie wprowadza; opisz potrzebę właścicielowi.`,
    );
  }
  lines.push(
    "Zasada: docs/data-isolation.md, pkt 3 i 5 — tabela powstaje razem z RLS i politykami, nigdy „RLS później”.",
    SKILL_HINT,
  );
  return lines.join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let event;
  try {
    event = JSON.parse(await readStdin());
  } catch {
    process.stderr.write("require-rls-in-migration: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const input = event?.tool_input ?? {};
  if (!isMigrationFile(input.file_path)) process.exit(0);

  const content = contentAfter(event.tool_name, input);
  // Unknown result (e.g. old_string not found): the tool itself will fail.
  if (content === null) process.exit(0);

  const missing = findTablesWithoutRls(content);
  const weakened = findWeakenedRls(content);
  if (missing.length > 0 || weakened.length > 0) {
    process.stderr.write(`${blockMessage(input.file_path, missing, weakened)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
