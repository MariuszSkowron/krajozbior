#!/usr/bin/env node
// PreToolUse hook (Claude Code): blocks every shell command that mentions a
// `.env` file (`.env`, `.env.local`, `.env.production`, `config/.env`, ...),
// whatever reads it (cat, head, type, Get-Content, grep, cp, node -e ...),
// and every glob that can expand to one (`.env*`, `.e?v`, `.[e]nv`, `*env`,
// `?env`, `.{e,x}nv`, a bare `*` in the current folder).
// `.env.example` is allowed: it holds no secrets.
//
// Rule: AGENTS.md ("Zasady") and security-notes.md, section 1, in the private
// documentation repository — the agent must not read real secrets.
// The `deny` rules in .claude/settings.json cover the Read tool (`**/.env`,
// `**/.env.*`, which includes `.env.example`: a deny rule has no exceptions)
// and a few concrete commands; this hook closes the gap for every other
// shell reader. `.env.example` is read from the shell (`cat .env.example`,
// `git show HEAD:.env.example`), which this hook lets through.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call and shows the reason to the agent; exit 0 lets
// it through. A malformed event exits 1 (a hook bug, reported but not blocking).
import { pathToFileURL } from "node:url";

import { detectionVariants, globToRegExp, joinContinuations } from "./lib/shell-text.mjs";

// `.env` or `.env.<suffix>` as a whole file name: not preceded by a name
// character (so `process.env` and `my-app.env` do not match) and not followed
// by one (so `.environment` does not match).
const ENV_FILE = /(?<![A-Za-z0-9_-])\.env(?:\.[A-Za-z0-9_-]+)*(?![A-Za-z0-9_-])/gi;
// The test environment of the agent keeps one-off passwords in `test-env.env`.
const TEST_ENV_FILE = /(?<![A-Za-z0-9_])test-env\.env(?![A-Za-z0-9_-])/gi;
const ALLOWED = new Set([".env.example"]);

// File names a glob must not be able to reach.
const SECRET_NAMES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local",
  ".env.staging",
  ".env.backup",
  "test-env.env",
];
const GLOB_CHARS = /[*?[{]/;
// Separators between the words of a command (paths never contain them). A
// comma is not one: it separates the options of a brace glob (`.{e,x}nv`).
const WORD_SPLIT = /[\s;&|<>()="'`]+/;

/** One concrete name a glob expands to, for suffixes the list above lacks. */
function concreteName(glob) {
  return glob
    .replace(/\{([^},]*)[^}]*\}/g, "$1")
    .replace(/\[!?\^?([^\]])[^\]]*\]/g, "$1")
    .replace(/\*/g, "")
    .replace(/\?/g, ".");
}

/** True when a glob word can expand to a secret file name. */
export function globReachesEnv(word) {
  if (!GLOB_CHARS.test(word)) return false;

  const parts = word.split(/[\\/]/);
  const last = parts.pop();
  const folder = parts.join("/");
  if (last === undefined || last === "") return false;

  // A bare wildcard (`*`, `*.*`, `?*`) in another folder (`src/*`) does not
  // reach the project's `.env`; in the current folder it does (PowerShell
  // globs match dot files).
  const onlyWildcards = /^[*?.]+$/.test(last) && !last.startsWith(".");
  if (onlyWildcards && folder !== "" && folder !== "." && folder !== "~") return false;

  const pattern = globToRegExp(last);
  if (SECRET_NAMES.some((name) => pattern.test(name))) return true;

  const concrete = concreteName(last).toLowerCase();
  return concrete !== ".env.example" && /^\.env(?:\.[a-z0-9_-]+)*$/.test(concrete);
}

/** The parts of the command that point at a secret file (empty = safe). */
export function findEnvReferences(command) {
  if (typeof command !== "string") return [];

  const found = [];
  for (const variant of detectionVariants(joinContinuations(command))) {
    for (const match of variant.matchAll(ENV_FILE)) {
      if (!ALLOWED.has(match[0].toLowerCase())) found.push(match[0]);
    }
    for (const match of variant.matchAll(TEST_ENV_FILE)) found.push(match[0]);
    for (const word of variant.split(WORD_SPLIT)) {
      if (globReachesEnv(word)) found.push(word);
    }
  }
  return [...new Set(found)];
}

export function referencesEnvFile(command) {
  return findEnvReferences(command).length > 0;
}

export function blockMessage(references) {
  return [
    `Zablokowano polecenie powłoki: odwołuje się do pliku z sekretami albo wzorca, który może go objąć (${references.join(", ")}).`,
    "Zasada: AGENTS.md („Zasady”) i security-notes.md, pkt 1 (repozytorium dokumentacji) — agent nie czyta ani nie zmienia plików `.env`.",
    "Nazwy zmiennych i przykładowe wartości są w `.env.example`: czytaj go poleceniem `cat .env.example` albo `git show HEAD:.env.example` (narzędzie Read go nie otworzy, bo reguła deny nie ma wyjątków).",
    "Zamiast wzorców z `*` lub `?` podaj konkretne nazwy plików.",
    "Jeśli potrzebna jest nowa zmienna, dopisz ją do `.env.example` i poproś właściciela o uzupełnienie `.env`.",
  ].join("\n");
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
    process.stderr.write("block-env-read: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const references = findEnvReferences(event?.tool_input?.command);
  if (references.length > 0) {
    process.stderr.write(`${blockMessage(references)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
