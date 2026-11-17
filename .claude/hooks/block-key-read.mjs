#!/usr/bin/env node
// PreToolUse hook (Claude Code): blocks every shell command that mentions the
// private key of the project's GitHub App or the folder that holds it:
//   - any `.pem` file (`cat x.pem`, `Get-Content key.PEM`, `copy *.pem`),
//     and globs that can reach one (`*.p?m`, `*.[p]em`, `*.{pem,x}`);
//   - any `.config` folder (`~/.config/<app>-bot`, `$env:USERPROFILE\.config`,
//     `%USERPROFILE%/.config/x`), and globs from the home folder that can reach
//     it (`~/.c*/*`, `$HOME/*/x`).
// Running `scripts/bot-token.ps1` passes: the script finds the key itself, so
// its command line names neither the file nor the folder.
//
// Rule: AGENTS.md ("Zasady") and security-notes.md, section 2, in the private
// documentation repository. The `deny` rules in .claude/settings.json cover
// the Read tool (`**/*.pem`, `~/.config/**`); this hook closes the gap for
// shell readers (cat, type, Get-Content, copy, Select-String, node -e ...).
// It reads command text only: a script that reads the key by itself is not
// caught (security-notes.md, "Klucz aplikacji GitHub").
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event exits
// 1 (a hook bug, reported but not blocking).
import { pathToFileURL } from "node:url";

import { detectionVariants, globToRegExp, joinContinuations } from "./lib/shell-text.mjs";

// A `.pem` file name (`key.pem`, `app.2026-11-17.private-key.pem`, `.pem`).
const PEM_FILE = /[^\s"'`;|&<>()=,]*\.pem(?![A-Za-z0-9_-])/gi;
// A `.config` folder: not part of a longer name (`vitest.config.mts`,
// `tsconfig.json` and `.config.js` do not match).
const CONFIG_DIR = /(?<![A-Za-z0-9_.-])\.config(?=[\\/]|$|[\s"'`;|&<>)])/gi;
const GLOB_CHARS = /[*?[{]/;
const WORD_SPLIT = /[\s;&|<>()="'`]+/;
// Starts of a path in the home folder, where `.config` lives.
const HOME_PREFIX =
  /^(?:~|\$HOME|\$\{HOME\}|\$env:(?:USERPROFILE|HOME)|%USERPROFILE%|%HOMEPATH%|[A-Za-z]:[\\/]Users[\\/][^\\/]+|\/[a-z]\/Users\/[^/]+|\/(?:home|Users)\/[^/]+)(?=[\\/]|$)/i;
const SAMPLE_KEY_NAMES = ["key.pem", "app.2026-01-01.private-key.pem"];

/** True when a glob word can expand to a `.pem` file or to the home `.config` folder. */
export function globReachesKey(word) {
  if (!GLOB_CHARS.test(word)) return false;
  const parts = word.split(/[\\/]/).filter(Boolean);
  const last = parts.at(-1);
  if (last !== undefined) {
    const pattern = globToRegExp(last);
    // Aimed at keys: reaches a `.pem` name but not an ordinary file. A plain
    // wildcard (`src/*`, `*.*`) is left to the other checks.
    const aimedAtKeys =
      SAMPLE_KEY_NAMES.some((name) => pattern.test(name)) && !pattern.test("file.ts");
    if (aimedAtKeys) return true;
  }
  const home = word.match(HOME_PREFIX);
  if (home === null) return false;
  const below = word.slice(home[0].length).split(/[\\/]/).filter(Boolean);
  return below.some((segment) => GLOB_CHARS.test(segment) && globToRegExp(segment).test(".config"));
}

/** The parts of the command that point at the app key or its folder (empty = safe). */
export function findKeyReferences(command) {
  if (typeof command !== "string") return [];

  const found = [];
  for (const variant of detectionVariants(joinContinuations(command))) {
    for (const match of variant.matchAll(PEM_FILE)) found.push(match[0]);
    for (const match of variant.matchAll(CONFIG_DIR)) found.push(match[0]);
    for (const word of variant.split(WORD_SPLIT)) {
      if (globReachesKey(word)) found.push(word);
    }
  }
  return [...new Set(found)];
}

export function blockMessage(references) {
  return [
    `Zablokowano polecenie powłoki: odwołuje się do klucza prywatnego aplikacji GitHub albo do folderu, w którym leży (${references.join(", ")}).`,
    "Zasada: AGENTS.md („Zasady”) i security-notes.md, sekcja 2 (repozytorium dokumentacji) — agent nie czyta, nie kopiuje i nie zmienia klucza (`*.pem`, `~/.config/<app-slug>/`).",
    "Token aplikacji odnawia skrypt: `powershell -ExecutionPolicy Bypass -File scripts/bot-token.ps1` (bez podawania ścieżki klucza).",
    "Wymianę klucza wykonuje właściciel w przeglądarce (security-notes.md, sekcja 2).",
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
    process.stderr.write("block-key-read: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const references = findKeyReferences(event?.tool_input?.command);
  if (references.length > 0) {
    process.stderr.write(`${blockMessage(references)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
