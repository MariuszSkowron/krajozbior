#!/usr/bin/env node
// PreToolUse hook (Claude Code): the agent does not change its own settings,
// hooks or skills in `.claude/` from the shell. The `deny` rules in
// .claude/settings.json already block the Edit, Write and MultiEdit tools
// there; this hook closes the shell route: redirects (`>`, `>>`, `| tee`),
// Set-Content / Out-File / Add-Content, cp / mv / Copy-Item / Move-Item into
// `.claude`, deleting, `sed -i`, `git checkout|restore` of those files,
// `node -e` and any other program that is not a known reader.
//
// Allowed: reading (`cat`, `Get-Content`, `ls`, `grep`, `git diff|log|show`,
// `git add`) – but never `sed`, not even `sed -n`: its options can be
// smuggled in by expansion (`{-i,}`, a quoted `-i`, a variable holding it), so a
// shell read of `.claude` with sed is blocked; agents read with the Read and
// Grep tools,
// running a hook script (`node .claude/hooks/<name>.mjs`) and
// everything inside an agent worktree (`.claude/worktrees/<name>/`), except
// that worktree's own `.claude/`; the worktree exception never applies to a
// path with `..` (`.claude/worktrees/../settings.json`). Also allowed:
// read-only checkers (`npx eslint .claude/hooks`, `npx prettier --check
// .claude`, without --fix / --write) and `code <file>`. `.mcp.json` gets the
// same protection as `.claude/`, and a `cd` through a glob or `..` that can
// land in `.claude` counts as entering it.
//
// Only one kind of text counts as data, not as a mention
// (lib/shell-text.mjs, "Message arguments"): the quoted message of
// `git commit -m` and the quoted `--title/--body` of `gh pr|issue
// create|edit|comment`, and only in a plain one-line command (no newline,
// `#`, `$`, backtick, `(`, `{`, `|`, `<`, `>`, heredoc or here-string,
// `\` before a quote, glued or typographic quotes). Otherwise the strict
// rules apply to the whole text. A heredoc body is checked like any other
// command text, so a run log that mentions `.claude` is blocked: write such a
// file with the Write tool.
//
// Also blocked: an interpreter in a command that mentions `.claude` (`echo
// 'rm .claude/x' | bash`, `| xargs rm`, `| iex`) and the writing options of
// readers (`git diff --output`, `rg --pre`, `tree -o`).
//
// Rule: AGENTS.md ("Zasady") and docs/agent-workflow.md — the owner changes
// agent settings by hand (or lifts this rule for the moment of the change);
// `.claude/` is also owned in CODEOWNERS, so a change still needs the owner's
// approval on GitHub. The hook reads the command text: a write built from
// pieces is not detected, and CODEOWNERS remains the boundary.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event
// exits 1 (a hook bug, reported but not blocking).
import { pathToFileURL } from "node:url";

import {
  baseName,
  detectionVariants,
  globToRegExp,
  maskShellData,
  splitSegments,
  words,
} from "./lib/shell-text.mjs";

// The agent worktrees of Claude Code live in `.claude/worktrees/<name>/`; work
// there is ordinary work on a copy of the repository. The exception never
// applies to a path that climbs out of it (`.claude/worktrees/../settings.json`).
const WORKTREE_PREFIX = /\.claude[\\/]+worktrees(?:[\\/]+[^\s\\/;|&<>]+)?([^\s;|&<>]*)/gi;
const PARENT_SEGMENT = /(?:^|[\\/])\.\.(?:[\\/]|$)/;
// `.claude` and the `.mcp.json` file (MCP servers run programs).
const MENTIONS_CLAUDE =
  /(?:^|[^A-Za-z0-9_-])(?:\.claude(?=$|[\\/\s;|&<>)])|\.mcp\.json(?=$|[\s;|&<>)]))/i;
const REDIRECT_INTO = /(?:^|[^<])>{1,2}\s*\S*\.(?:claude(?=$|[\\/\s])|mcp\.json(?=$|\s))/i;
const CHANGE_DIRECTORY = new Set(["cd", "set-location", "sl", "pushd", "chdir", "push-location"]);
const GLOB_CHARS = /[*?[{]/;

// Programs that only read the files they are given.
const READERS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "type",
  "gc",
  "get-content",
  "ls",
  "dir",
  "gci",
  "get-childitem",
  "get-item",
  "test-path",
  "resolve-path",
  "stat",
  "wc",
  "file",
  "grep",
  "egrep",
  "rg",
  "select-string",
  "sls",
  "findstr",
  "diff",
  "cmp",
  "fc",
  "get-filehash",
  "sha256sum",
  "md5sum",
  "jq",
  "echo",
  "write-output",
  "write-host",
  "tree",
]);
const GIT_READS = new Set([
  "diff",
  "log",
  "show",
  "status",
  "ls-files",
  "grep",
  "blame",
  "check-ignore",
  "cat-file",
  "rev-parse",
  "ls-tree",
  "add",
]);
const FIND_WRITES = /\s-(?:delete|exec|execdir|ok|okdir|fprint\w*|fls)\b/i;
// Options with which a reader writes a file or runs a program.
const READER_WRITES = {
  git: /\s--output\b/i,
  rg: /\s--pre(?=[\s=]|$)/i,
  tree: /\s-o(?=\s|$)/,
};
// Programs that run what they read (`echo 'rm .claude/x' | bash`, `| xargs rm`).
const STDIN_RUNNERS = new Set([
  "bash",
  "sh",
  "zsh",
  "dash",
  "ksh",
  "pwsh",
  "powershell",
  "cmd",
  "node",
  "python",
  "python3",
  "py",
  "perl",
  "ruby",
  "iex",
  "invoke-expression",
  "xargs",
  "source",
  ".",
]);
/** The program name of a word, without `.exe` / `.cmd`. */
const programOf = (word) => baseName(word ?? "").replace(/\.(?:exe|cmd)$/, "");

/** The words of a segment after `git` and its `-C`/`-c` options. */
function gitSubcommand(segmentWords) {
  let i = 1;
  while (i < segmentWords.length && /^(?:-C|-c)$/.test(segmentWords[i])) i += 2;
  while (i < segmentWords.length && segmentWords[i].startsWith("-")) i += 1;
  return segmentWords[i];
}

// Checkers that read files unless told to write: `eslint` without --fix or
// --output-file, `prettier` only with --check / --list-different and no --write.
const WRITING_ESLINT = /\s(?:--fix\S*|--output-file\S*|-o)(?=\s|=|$)/;
const CHECKING_PRETTIER = /\s(?:--check|-c|--list-different|-l)(?=\s|$)/;
const WRITING_PRETTIER = /\s(?:--write|-w|--cache-location\S*)(?=\s|$)/;
const RUNNERS = new Set(["npx", "pnpx", "bunx"]);

/** The tool run by `npx [flags] <tool> ...`, with its arguments. */
function runnerTool(segmentWords) {
  const rest = segmentWords.slice(1);
  let i = 0;
  while (i < rest.length && rest[i].startsWith("-") && rest[i] !== "--") i += 1;
  if (rest[i] === "--") i += 1;
  return rest[i] === undefined
    ? null
    : { name: baseName(rest[i]).replace(/\.(?:exe|cmd)$/, ""), index: i };
}

/** True for an eslint or prettier call that only checks. */
function isChecker(name, segment) {
  if (name === "eslint") return !WRITING_ESLINT.test(segment);
  if (name === "prettier")
    return CHECKING_PRETTIER.test(segment) && !WRITING_PRETTIER.test(segment);
  return false;
}

/** True when a segment only reads (or runs a hook script). */
function isReadOnly(segment) {
  const segmentWords = words(segment);
  const program = programOf(segmentWords[0]);

  if (READER_WRITES[program]?.test(segment)) return false;
  if (READERS.has(program)) return true;
  if (program === "code" || program === "code-insiders") return true;
  if (program === "eslint" || program === "prettier") return isChecker(program, segment);
  if (RUNNERS.has(program)) {
    const tool = runnerTool(segmentWords);
    return tool !== null && isChecker(tool.name, segment);
  }
  if (program === "find") return !FIND_WRITES.test(segment);
  if (program === "git") return GIT_READS.has(gitSubcommand(segmentWords));
  if (program === "node") {
    return (
      segmentWords.length >= 2 &&
      /^\.?[\\/]?\.claude[\\/]hooks[\\/][\w.-]+\.mjs$/.test(segmentWords[1])
    );
  }
  return false;
}

// Redirects that write nowhere: `2>/dev/null`, `2>$null`, `2>&1`, `*>&1`.
const HARMLESS_REDIRECT = /[0-9*]?>{1,2}\s*(?:&\d|\/dev\/null|\$null|nul)(?=$|[\s;&|)])/gi;

/**
 * The text with agent worktree prefixes replaced (their own `.claude` stays
 * visible) and redirects that write nowhere removed.
 */
function withoutWorktrees(text) {
  return text
    .replace(WORKTREE_PREFIX, (whole, rest) =>
      PARENT_SEGMENT.test(whole) ? whole : `WORKTREE${rest}`,
    )
    .replace(HARMLESS_REDIRECT, " ");
}

/**
 * True when a `cd` target can land in `.claude` without naming it: a glob that
 * matches `.claude` (`.cl*`, `.c?aude`, `.[c]laude`), or `..` in a command that
 * also mentions `.claude` (`cd .claude/worktrees/x && cd ../..`).
 */
function entersClaudeIndirectly(segmentWords, commandMentionsClaude) {
  return segmentWords
    .slice(1)
    .filter((word) => !word.startsWith("-"))
    .some((target) => {
      const last = target.split(/[\\/]/).filter(Boolean).pop() ?? "";

      if (last === "..") return commandMentionsClaude;
      return reachesClaude(last);
    });
}

/** True when a path component is a glob (with a literal part) that matches `.claude`. */
function reachesClaude(component) {
  if (!GLOB_CHARS.test(component) || /^[*?]+$/.test(component)) return false;
  return globToRegExp(component).test(".claude");
}

/** True when a word has a path component that is a glob matching `.claude`. */
function wordReachesClaude(word) {
  return word
    .replace(/^[<>=(]+/, "")
    .split(/[\\/]/)
    .some(reachesClaude);
}

/** Reasons to block the command (an empty list lets it through). */
export function findAgentConfigWrites(command) {
  if (typeof command !== "string") return [];
  const reasons = new Set();
  const masked = maskShellData(command);

  for (const variant of detectionVariants(masked)) {
    const text = withoutWorktrees(variant);
    const commandMentionsClaude = MENTIONS_CLAUDE.test(variant);
    // Nothing names `.claude` (not even a worktree) and no glob can reach it.
    if (!commandMentionsClaude && !text.split(/[\s;|&<>()]+/).some(wordReachesClaude)) continue;

    const segments = splitSegments(text);
    // `cd .claude && echo x > settings.json`: after entering `.claude`, every
    // later segment counts as touching it.
    let inside = false;

    for (const segment of segments) {
      const segmentWords = words(segment);
      const program = baseName(segmentWords[0] ?? "");
      const mentions = MENTIONS_CLAUDE.test(segment) || segmentWords.some(wordReachesClaude);

      if (
        CHANGE_DIRECTORY.has(program) &&
        (mentions || entersClaudeIndirectly(segmentWords, commandMentionsClaude))
      ) {
        inside = true;
        continue;
      }
      if (REDIRECT_INTO.test(segment) || ((mentions || inside) && segment.includes(">"))) {
        reasons.add(`zapis do .claude/ przekierowaniem: "${segment}"`);
        continue;
      }
      if ((mentions || inside) && !isReadOnly(segment)) {
        reasons.add(`polecenie może zmienić .claude/: "${segment}"`);
      } else if (
        !mentions &&
        MENTIONS_CLAUDE.test(text) &&
        STDIN_RUNNERS.has(programOf(segmentWords[0]))
      ) {
        reasons.add(`interpreter w poleceniu, które wspomina .claude/: "${segment}"`);
      }
    }
  }
  return [...reasons];
}

export function blockMessage(reasons) {
  return [
    `Zablokowano polecenie: ${reasons.join("; ")}.`,
    "Agent nie zmienia swoich ustawień, hooków ani skilli w `.claude/` (reguły deny dla Edit/Write i ten hook dla powłoki).",
    "Wolno czytać (`cat`, `Get-Content`, `git diff`) i uruchamiać hook (`node .claude/hooks/<plik>.mjs`).",
    "Zmianę w `.claude/` wprowadza właściciel ręcznie albo po czasowym zdjęciu tej reguły; opisz mu, co i dlaczego zmienić (docs/agent-workflow.md).",
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
    process.stderr.write("protect-agent-config: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const reasons = findAgentConfigWrites(event?.tool_input?.command);
  if (reasons.length > 0) {
    process.stderr.write(`${blockMessage(reasons)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
