#!/usr/bin/env node
// PreToolUse hook (Claude Code): the agent changes files with the Edit and
// Write tools, not from the shell. Writing from the shell (`echo x > f`,
// `cat <<EOF > f`, `| tee f`, `sed -i`, `Set-Content`, `Out-File`,
// `[IO.File]::WriteAllText`, `node -e "fs.writeFileSync(...)"`) skips the hooks
// that guard Edit/Write (e.g. require-rls-in-migration.mjs) and the review of
// the change in the tool call. This hook blocks such writes for the Bash and
// PowerShell tools.
//
// Allowed targets: anything under `.ai/tmp/` (of any worktree), the system
// temp folder (`/tmp`, `$TMPDIR`, `$env:TEMP`, `%TEMP%`, `AppData/Local/Temp`,
// which also holds the session scratchpad), and places that write nowhere
// (`/dev/null`, `$null`, `NUL`). A `..` after the allowed prefix cancels the
// exception (`.ai/tmp/../src/x`). After `cd` into an allowed folder, relative
// targets without `..` count as allowed too.
// Allowed commands: stream redirects (`2>&1`, `>&2`, `*>&1`), everything that
// only reads (`git commit -F file` reads the file), formatters and fixers
// (`npx prettier --write`, `eslint --fix`): they are not a hand-written text.
//
// False blocks are worse than a rare miss: text inside quotes (`git commit -m
// "a > b"`, `grep "x>y"`), heredoc bodies and PowerShell here-strings are data,
// not redirects; `$(( a > b ))` and `[[ a > b ]]` are comparisons. Quoted code
// is inspected only for interpreters (`node -e`, `python -c`, `bash -c`,
// `pwsh -Command`, `cmd /c`), where it is the program.
//
// Comments (`# ...` after whitespace or at the start of a line; `<# ... #>` in
// PowerShell) are ignored: a `>` in them is text. A `#` inside a word
// (`a#b`, `${#arr}`, a URL fragment) does not start a comment.
//
// A variable assigned a literal in the same command (`X=src/a.ts; echo x > $X`,
// `$p = 'src\a.ts'; Set-Content $p`) is replaced by its value before the target
// is judged. A target that starts with a variable of unknown value (`> $LOG`,
// `Out-File $out`, `${TMPDIR:-/tmp}/o.txt`) is let through: a false block is
// worse than a miss. It is still blocked when the variable is a known repo root
// (`$PWD`, `$ROOT`, `$PSScriptRoot`) or the literal part after it names a repo
// folder (`$ROOT/src/a.ts`). `$HOME` and the user profile variable count like `~`
// (blocked).
//
// A target that is an expression (`(Join-Path $PWD 'a.ts')`, `$(pwd)/a.ts`,
// `(Resolve-Path a.ts)`) is read whole, with balanced parentheses, and let
// through only when it names a temp folder (the temp variables, `/tmp`,
// `AppData/Local/Temp`, `.ai/tmp`, `mktemp`) without `..`; otherwise blocked.
//
// Known gaps (the hook reads the command text, it does not run it): a script
// file run by an interpreter (`node .ai/tmp/x.mjs`), `awk` with `print > f`,
// `xargs sed -i`, `git apply`, `patch`, `curl -o`, `tar`/`unzip`, `Export-Csv`,
// `>|` (clobber redirect), `touch`, `New-Item -ItemType File` without `-Value`,
// `Start-Process -RedirectStandardOutput`, a target from a variable of unknown
// value (or one assigned in a way this reader does not follow: `Set-Variable`,
// `[string]$p = ...`, `read X <<< ...`), loops and pipes over repo files
// (`for f in src/*.ts; do sed -i ... "$f"; done`, `... | ForEach-Object { ... |
// Set-Content $_ }`, `foreach ($f in ...)`), an interpreter reading its program
// from a pipe (`echo ... | node`), `$(mktemp -p src)` (the word `mktemp` counts as
// temp), `(Join-Path 'src' '/tmp/a.ts')` (`/tmp` inside the expression counts as
// temp), and two odd Bash cases where `#` after a space is not a comment but is
// read as one: inside backticks and inside `${x:- #}`. Known false alarm:
// `cd "$(mktemp -d)" && echo x > a.txt` is blocked.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event
// exits 1 (a hook bug, reported but not blocking).
import { pathToFileURL } from "node:url";

import { baseName, joinContinuations } from "./lib/shell-text.mjs";

const FILL = "_";
const MAX_DEPTH = 3;

// ---------------------------------------------------------------------------
// Targets

// Places that write nowhere (also `tee -`, which writes to stdout).
const DISCARD = /^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|\$null|nul:?|con:?|-)$/;
// Temp folders named by a variable or by their root (at the start of a path).
const TEMP_ROOT =
  /^(?:\$\{(?:tmpdir|tmp|temp)(?::?-[^}]*)?\}|\$(?:tmpdir|tmp|temp)|\$env:(?:tmp|temp)|\$\{env:(?:tmp|temp)\}|\$env:localappdata\/temp|%(?:tmp|temp)%|\/tmp)(?=\/|$)/;
// Allowed folders anywhere in a path: `.ai/tmp` of any worktree, the user temp.
const SCRATCH_INSIDE = /(?:^|\/)(?:\.ai\/tmp|appdata\/local\/temp)(?=\/|$)/;
const PARENT = /(?:^|\/)\.\.(?:\/|$)/;

/** A path as compared here: forward slashes, lower case, no surrounding quotes. */
function normalise(target) {
  return String(target)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/")
    .toLowerCase();
}

const isRelative = (path) => !/^(?:[/~$%]|[a-z]:)/.test(path);

/** True for a target that writes nowhere (`/dev/null`, `$null`, `NUL`). */
export function isDiscard(target) {
  return DISCARD.test(normalise(target));
}

/** True for a target in `.ai/tmp/` or the system temp folder (no `..` after it). */
export function isScratch(target, context = {}) {
  const path = normalise(target);
  const root = TEMP_ROOT.exec(path) ?? SCRATCH_INSIDE.exec(path);
  let rest;

  if (root) rest = path.slice(root.index + root[0].length);
  else if (context.inScratch && isRelative(path)) rest = path;
  else return false;
  return !PARENT.test(rest);
}

// A target that starts with a variable or an expression: its value is unknown.
const DYNAMIC_HEAD = /^(?:\$\{[^}]*\}|\$env:\w+|\$\w+|\$\(|\()/;
// The home folder is a known absolute path outside temp: it counts like `~`.
const HOME_VARIABLE =
  /^(?:\$\{home\}|\$home|\$env:(?:userprofile|homepath|home)|\$\{env:(?:userprofile|homepath|home)\})(?=\/|$)/;
// An expression target is allowed only when it names a temp folder.
const TEMP_EXPRESSION =
  /\$env:(?:tmp|temp)\b|\$\{env:(?:tmp|temp)\}|\$\{?(?:tmpdir|tmp|temp)\b|%(?:tmp|temp)%|(?:^|[\s(,'"=])\/tmp(?=\/|\W|$)|appdata\/local\/temp|\.ai\/tmp|\$env:localappdata[^)]*temp|\bmktemp\b|gettemppath|gettempfilename|new-temporaryfile/;
const PARENT_ANYWHERE = /(?:^|[^.])\.\.(?:[^.]|$)/;
const EXPRESSION_HEAD = /^\$?\(/;
// Variables that point at the repository (cwd, project root).
const REPO_VARIABLE =
  /^\$\{?(?:pwd|psscriptroot|cwd|root|repo\w*|claude_project_dir|project\w*|workspace\w*|ws\w*|git_root)\}?$/;
const REPO_FOLDER =
  /^(?:src|docs|tests?|scripts|e2e|public|\.claude|\.github|\.husky|node_modules|package(?:-lock)?\.json|tsconfig[\w.]*|readme\.md|agents\.md|claude\.md|\.env[\w.]*)$/;

/**
 * True for a target whose start is a variable or an expression and whose
 * literal part does not point into the repository (see the header comment).
 */
function isDynamicTarget(target) {
  const path = normalise(target);
  const head = DYNAMIC_HEAD.exec(path);
  if (!head || TEMP_ROOT.test(path) || HOME_VARIABLE.test(path)) return false;
  if (head[0].endsWith("(")) return TEMP_EXPRESSION.test(path) && !PARENT_ANYWHERE.test(path);
  if (REPO_VARIABLE.test(head[0])) return false;
  const segments = path
    .slice(head[0].length)
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  const checked = segments.includes("..") ? segments : segments.slice(0, 1);
  return !checked.some((segment) => REPO_FOLDER.test(segment));
}

// `$name`, `${name}`, `$env:name` at the start of a target.
const VARIABLE_HEAD = /^\$(?:\{(env:\w+|\w+)\}|(env:\w+|\w+))/i;

/** The target with a variable assigned a literal in the same command replaced by its value. */
function resolveVariables(target, context) {
  const vars = context.vars;
  if (!vars || vars.size === 0) return target;
  let current = String(target)
    .trim()
    .replace(/^["']|["']$/g, "");
  let changed = false;

  for (let depth = 0; depth < 3; depth += 1) {
    const match = VARIABLE_HEAD.exec(current);
    const value = match ? vars.get((match[1] ?? match[2]).toLowerCase()) : undefined;
    if (value === undefined) break;
    current = value + current.slice(match[0].length);
    changed = true;
  }
  return changed ? current : target;
}

/** The target as shown in a block message (with its value and a hint for an expression). */
function describeTarget(target, context) {
  const resolved = resolveVariables(target, context);
  let text = `"${target}"`;
  if (resolved !== target) text += ` (= "${resolved}")`;
  if (EXPRESSION_HEAD.test(normalise(resolved))) {
    text += " (cel zapisu jest wyrażeniem: zapisz do `.ai/tmp/` albo użyj narzędzia Write)";
  }
  return text;
}

/** True for a target the agent may write from the shell. */
export function isAllowedTarget(target, context = {}) {
  const resolved = resolveVariables(target, context);
  return isDiscard(resolved) || isScratch(resolved, context) || isDynamicTarget(resolved);
}

// ---------------------------------------------------------------------------
// Text: heredocs, quotes, segments, words

const HEREDOC = /(?<!<)<<(?!<)-?[ \t]*(["']?)([A-Za-z_][\w-]*)\1/g;

/**
 * The command without heredoc bodies (they are data) and the bodies apart.
 * A heredoc without its terminator line is left in place.
 */
function stripHeredocs(text) {
  const lines = text.split(/\r?\n/);
  const kept = [];
  const bodies = [];

  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    for (const marker of lines[i].matchAll(HEREDOC)) {
      const tag = marker[2];
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== tag) j += 1;
      if (j >= lines.length) break;
      bodies.push(lines.slice(i + 1, j).join("\n"));
      i = j;
    }
  }
  return { text: kept.join("\n"), bodies };
}

const escapeOf = (shell) => (shell === "bash" ? "\\" : shell === "cmd" ? "^" : "`");

/**
 * The text with the inside of quotes (and PowerShell here-strings), comments
 * and escaped characters replaced by `_` (`masked`), and the text with comments
 * blanked (`cleaned`). Same length as the input, so an index found in the
 * masked text points at the same place in the original. An unclosed quote
 * masks the rest (a false block is worse than a rare miss).
 */
function maskQuoted(text, shell) {
  const escape = escapeOf(shell);
  const out = text.split("");
  const cleaned = text.split("");
  const fill = (from, to) => {
    for (let k = from; k < Math.min(to, out.length); k += 1) out[k] = FILL;
  };
  // A comment keeps its line breaks, so the lines stay separate commands.
  const blank = (from, to) => {
    for (let k = from; k < Math.min(to, out.length); k += 1) {
      if (text[k] !== "\n" && text[k] !== "\r") {
        out[k] = FILL;
        cleaned[k] = " ";
      }
    }
  };
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (shell === "powershell" && char === "<" && next === "#") {
      const end = text.indexOf("#>", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (char === "#" && shell !== "cmd" && (i === 0 || /\s/.test(text[i - 1]))) {
      let stop = text.indexOf("\n", i);
      if (stop === -1) stop = text.length;
      blank(i, stop);
      i = stop;
      continue;
    }

    if (shell === "powershell" && char === "@" && (next === "'" || next === '"')) {
      const end = text.indexOf(`\n${next}@`, i + 2);
      if (end !== -1) {
        fill(i + 2, end + 1);
        i = end + 3;
        continue;
      }
    }
    if (char === escape) {
      fill(i + 1, i + 2);
      i += 2;
    } else if (char === "'" && shell !== "cmd") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      fill(i + 1, stop);
      i = stop + 1;
    } else if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === escape && shell !== "cmd" ? 2 : 1;
      fill(i + 1, j);
      i = j + 1;
    } else i += 1;
  }
  return { masked: out.join(""), cleaned: cleaned.join("") };
}

// Bash arithmetic and test brackets: `>` there compares, it does not redirect.
const BASH_COMPARISONS = /\(\([\s\S]*?\)\)|\[\[[\s\S]*?\]\]/g;

// Command separators, found in the masked text (never inside quotes). A single
// `&` next to `>` belongs to a redirect (`2>&1`, `&>file`), not a separator.
const SEPARATOR =
  /\r?\n|&&|\|\||[;|]|(?<![>&])&(?![>&])|\$\(|(?<=^|[\s;|&])\(|\)|(?<=^|\s)\{(?=\s)|(?<=^|[\s;])\}/g;

/**
 * Segments as `{ raw, masked, full, start, expr }`: `raw` and `masked` are the same
 * text, `full` is the whole command and `start` the segment's place in it. A segment
 * cut at `(` or `$(` carries the whole expression after the cut as `expr` (`glued`
 * when no space separates it from the text before).
 */
function segmentsOf(raw, masked) {
  const segments = [];
  let start = 0;
  const push = (end, expr, glued) => {
    if (raw.slice(start, end).trim()) {
      segments.push({
        raw: raw.slice(start, end),
        masked: masked.slice(start, end),
        full: raw,
        start,
        expr,
        glued,
      });
    }
  };

  for (const match of masked.matchAll(SEPARATOR)) {
    const opens = match[0] === "(" || match[0] === "$(";
    const glued = !/\s/.test(raw[match.index - 1] ?? " ");
    push(match.index, opens ? readTarget(raw, match.index) : undefined, glued);
    start = match.index + match[0].length;
  }
  push(raw.length);
  return segments;
}

/** The words of a segment with quotes and escapes resolved. */
export function parseWords(text, shell = "bash") {
  const escape = escapeOf(shell);
  const result = [];
  let word = null;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (/\s/.test(char)) {
      if (word !== null) result.push(word);
      word = null;
      continue;
    }
    word ??= "";
    if (char === "'" && shell !== "cmd") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      word += text.slice(i + 1, stop);
      i = stop;
    } else if (char === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        const escapes =
          text[j] === escape &&
          shell !== "cmd" &&
          (shell === "powershell" || /[$`"\\]/.test(text[j + 1] ?? ""));
        if (escapes) j += 1;
        word += text[j] ?? "";
        j += 1;
      }
      i = j;
    } else if (char === escape && /[\s'"\\$`<>|;&()]/.test(text[i + 1] ?? "")) {
      word += text[i + 1];
      i += 1;
    } else word += char;
  }
  if (word !== null) result.push(word);
  return result;
}

/** The end (exclusive) of the parenthesised expression whose `(` is at `open`. */
function expressionEnd(text, open) {
  let depth = 0;

  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'" || char === '"') {
      const end = text.indexOf(char, i + 1);
      if (end === -1) return text.length;
      i = end;
    } else if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

/** The target word that starts at `start` (quotes removed; an expression kept whole). */
function readTarget(raw, start) {
  let i = start;
  let word = "";

  while (i < raw.length && /[ \t]/.test(raw[i])) i += 1;
  while (i < raw.length) {
    const char = raw[i];
    if (char === "(" && (word === "" || word === "$")) {
      const stop = expressionEnd(raw, i);
      word += raw.slice(i, stop);
      i = stop;
    } else if (char === "'" || char === '"') {
      const end = raw.indexOf(char, i + 1);
      const stop = end === -1 ? raw.length : end;
      word += raw.slice(i + 1, stop);
      i = stop + 1;
    } else if (/[\s;|&<>()]/.test(char)) break;
    else {
      word += char;
      i += 1;
    }
  }
  return word;
}

const PREFIX_WORDS = new Set([
  "sudo",
  "time",
  "nohup",
  "exec",
  "command",
  "builtin",
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
  "env",
  ".",
]);

/** Words without leading keywords, `VAR=x` assignments and `$x =`. */
function withoutPrefixes(segmentWords) {
  const result = segmentWords.map((word, index) =>
    index === 0 ? word.replace(/^[({]+/, "") : word,
  );
  while (result.length > 0) {
    if (result[0] === "") result.shift();
    else if (PREFIX_WORDS.has(result[0].toLowerCase())) result.shift();
    else if (/^[A-Za-z_]\w*=/.test(result[0])) result.shift();
    else if (/^\$[\w:]+$/.test(result[0]) && result[1] === "=") result.splice(0, 2);
    else break;
  }
  return result;
}

const programName = (word) => baseName(word).replace(/\.(?:exe|cmd|bat)$/, "");

// ---------------------------------------------------------------------------
// Checks

/** `>`, `>>`, `1>`, `2>`, `&>`, `*>` outside quotes, with their targets. */
function checkRedirects({ masked, full, start }, shell, context, reasons) {
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] !== ">" || masked[i - 1] === "=") continue;
    let j = i + 1;

    if (masked[j] === ">") j += 1;
    if (masked[j] === "|") j += 1;
    if (masked[j] === "(" && shell !== "powershell") {
      // Bash process substitution `>(cmd)`.
      i = j;
      continue;
    }
    if (masked[j] === "&") {
      // `2>&1`, `>&2`, `>&-`: a stream joined to another one.
      if (/[\d-]/.test(masked[j + 1] ?? "")) {
        i = j;
        continue;
      }
      j += 1;
    }
    const target = readTarget(full, start + j);
    i = j - 1;
    if (target !== "" && !isAllowedTarget(target, context)) {
      reasons.add(`przekierowanie do ${describeTarget(target, context)}`);
    }
  }
}

const PS_PATH_PARAM = /^-(?:path|literalpath|filepath|pspath|lp|fp|destination)$/i;
const PS_SWITCH =
  /^-(?:force|nonewline|append|noclobber|passthru|whatif|confirm|asbytestream|unbuffered|raw|verbose|debug|recurse|container)$/i;

/** Named and positional arguments of a PowerShell cmdlet call. */
function psArguments(segmentWords) {
  const named = {};
  const positional = [];

  for (let i = 1; i < segmentWords.length; i += 1) {
    const word = segmentWords[i];
    const option = /^(-[A-Za-z]+)(?::(.*))?$/.exec(word);
    if (!option) {
      positional.push(word);
      continue;
    }
    const name = option[1].toLowerCase();
    if (PS_SWITCH.test(name)) continue;
    const value = option[2] ?? segmentWords[(i += 1)];
    // A value missing at the end of a segment is a `(`-expression cut off by the separator.
    named[name] = value ?? "(";
  }
  return { named, positional };
}

/** The file targets of Set-Content / Add-Content / Out-File / Tee-Object / New-Item. */
function psWriteTargets(segmentWords) {
  const { named, positional } = psArguments(segmentWords);
  const paths = Object.entries(named)
    .filter(([name]) => PS_PATH_PARAM.test(name) && name !== "-destination")
    .map(([, value]) => value);
  const targets = paths.length > 0 ? paths : positional.slice(0, 1);
  return targets.flatMap((target) => (EXPRESSION_HEAD.test(target) ? [target] : target.split(",")));
}

/** The files `sed -i` changes, or null without `-i`. */
function sedTargets(segmentWords) {
  let inPlace = false;
  let scriptGiven = false;
  const files = [];

  for (let i = 1; i < segmentWords.length; i += 1) {
    const word = segmentWords[i];
    if (word === "--") {
      files.push(...segmentWords.slice(i + 1));
      break;
    }
    if (/^--in-place/.test(word)) inPlace = true;
    else if (/^--(?:expression|file)$/.test(word)) {
      scriptGiven = true;
      i += 1;
    } else if (/^--(?:expression|file)=/.test(word)) scriptGiven = true;
    else if (/^-[A-Za-z]/.test(word)) {
      if (/^-[A-Za-z]*i/.test(word)) inPlace = true;
      if (/^-[A-Za-z]*[ef]$/.test(word)) {
        scriptGiven = true;
        i += 1;
      }
    } else if (!word.startsWith("-")) files.push(word);
  }
  if (!inPlace) return null;
  return scriptGiven ? files : files.slice(1);
}

/** The files `perl -i` changes, or null without `-i`. */
function perlTargets(segmentWords) {
  let inPlace = false;
  let code = false;
  const files = [];

  for (let i = 1; i < segmentWords.length; i += 1) {
    const word = segmentWords[i];
    if (/^-[A-Za-z]/.test(word)) {
      if (/^-[A-Za-z]*i/.test(word)) inPlace = true;
      if (/[eE]$/.test(word)) {
        code = true;
        i += 1;
      }
    } else files.push(word);
  }
  if (!inPlace) return null;
  return code ? files : files.slice(1);
}

// Write calls in interpreter code (Node, Python, Ruby, Perl) and .NET.
const SCRIPT_WRITES = [
  {
    pattern:
      /\b(?:writeFileSync|appendFileSync|writeFile|appendFile|createWriteStream|outputFileSync|outputFile|copyFileSync|cpSync|renameSync)\s*\(/g,
    target: "first",
  },
  { pattern: /\bopen\s*\([^)]*?,\s*(?:mode\s*=\s*)?["'][rbtU]*[wax+]/g, target: "first" },
  { pattern: /\.write_(?:text|bytes)\s*\(/g, target: "path-before" },
  { pattern: /\bFile\.(?:write|binwrite)\s*\(/g, target: "first" },
  { pattern: /\bopen\s*\(?\s*(?:my\s+)?\$?\w+\s*,\s*["']\s*\+?>/g, target: "perl" },
];
const DOTNET_WRITES =
  /\[(?:System\.)?IO\.File\]::(?:WriteAll\w+|AppendAll\w+|Create|CreateText|AppendText|OpenWrite|Copy|Move|Replace)\s*\(|(?:New-Object\s+(?:-TypeName\s+)?|\[)(?:System\.)?IO\.StreamWriter\]?(?:::new)?\s*\(?/gi;

/** The top-level arguments of a call whose `(` is at `open`. */
function callArguments(text, open) {
  const args = [];
  let depth = 0;
  let current = "";

  for (let i = open + 1; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'" || char === '"' || char === "`") {
      const end = text.indexOf(char, i + 1);
      const stop = end === -1 ? text.length - 1 : end;
      current += text.slice(i, stop + 1);
      i = stop;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      current += char;
    } else if ((char === ")" || char === "]" || char === "}") && depth > 0) {
      depth -= 1;
      current += char;
    } else if (char === ")" && depth === 0) break;
    else if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else current += char;
  }
  args.push(current.trim());
  return args;
}

/** The string of a plain literal argument (`'x'`, `"x"`, `` `x` ``), else null. */
function literal(argument) {
  const match = /^(["'`])([^"'`]*)\1$/.exec(argument ?? "");
  return match ? match[2] : null;
}

/** The file a write call names, or null when it cannot be read from the text. */
function writeCallTarget(text, match, kind) {
  if (kind === "path-before") {
    const before = /\(\s*(["'])([^"']*)\1\s*\)\s*$/.exec(text.slice(0, match.index));
    return before ? before[2] : null;
  }
  const open = text.indexOf("(", match.index);
  if (open === -1) return null;
  const args = callArguments(text, open);
  if (kind === "first") return literal(args[0]);
  // Perl: open(FH, ">file") or open(FH, ">", "file").
  for (const argument of args.slice(1)) {
    const value = literal(argument);
    if (value === null) return null;
    const path = value.replace(/^\s*\+?[<>]{1,2}\s*/, "");
    if (path !== "") return path;
  }
  return null;
}

/** Reasons for write calls in interpreter code. */
function checkScriptWrites(code, label, context, reasons) {
  for (const { pattern, target: kind } of SCRIPT_WRITES) {
    for (const match of code.matchAll(pattern)) {
      const target = writeCallTarget(code, match, kind);
      if (target === null || !isAllowedTarget(target, context)) {
        const name = match[0].replace(/\s*\($/, "").trim();
        reasons.add(`${label} z zapisem pliku (${name}${target ? ` → "${target}"` : ""})`);
      }
    }
  }
}

const INTERPRETERS = new Set(["node", "bun", "deno", "python", "python3", "py", "ruby", "perl"]);
const BASH_SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const PS_SHELLS = new Set(["pwsh", "powershell"]);
const CHANGE_DIRECTORY = new Set(["cd", "set-location", "sl", "pushd", "push-location", "chdir"]);
const BASH_COPIES = new Set(["cp", "mv", "install"]);
const PS_COPIES = new Set(["copy-item", "cpi", "copy", "move-item", "mi", "move", "cp", "mv"]);
const PS_COMMAND_FLAG = /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i;
const PS_ENCODED_FLAG = /^-(?:e|ec|en|enc|encodedcommand)$/i;

/** Reasons from code another shell runs (`bash -c`, `pwsh -Command`, `cmd /c`, `eval`). */
function checkNestedShell(program, segmentWords, segment, bodies, shell, depth, reasons) {
  const nested = (code, nestedShell) => {
    for (const reason of findShellFileWrites(code, nestedShell, depth + 1)) reasons.add(reason);
  };

  if (BASH_SHELLS.has(program)) {
    const flag = segmentWords.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
    if (flag !== -1 && segmentWords[flag + 1] !== undefined) nested(segmentWords[flag + 1], "bash");
    if (segment.raw.includes("<<")) bodies.forEach((body) => nested(body, "bash"));
    return true;
  }
  if (PS_SHELLS.has(program)) {
    const command = segmentWords.findIndex((word) => PS_COMMAND_FLAG.test(word));
    const encoded = segmentWords.findIndex((word) => PS_ENCODED_FLAG.test(word));
    if (command !== -1) nested(segmentWords.slice(command + 1).join(" "), "powershell");
    if (encoded !== -1 && segmentWords[encoded + 1]) {
      nested(Buffer.from(segmentWords[encoded + 1], "base64").toString("utf16le"), "powershell");
    }
    return true;
  }
  if (program === "cmd") {
    const flag = segmentWords.findIndex((word) => /^\/[ck]$/i.test(word));
    if (flag !== -1) nested(segmentWords.slice(flag + 1).join(" "), "cmd");
    return true;
  }
  if (program === "eval" && shell === "bash") {
    nested(segmentWords.slice(1).join(" "), "bash");
    return true;
  }
  if (program === "iex" || program === "invoke-expression") {
    nested(
      segmentWords
        .slice(1)
        .filter((word) => !/^-command$/i.test(word))
        .join(" "),
      "powershell",
    );
    return true;
  }
  return false;
}

/** Reasons for copying a scratch file (`.ai/tmp`, temp) into the repository. */
function checkCopy(program, segmentWords, shell, context, reasons) {
  let sources;
  let destination;

  if (shell === "powershell" && PS_COPIES.has(program)) {
    const { named, positional } = psArguments(segmentWords);
    sources = [named["-path"] ?? named["-literalpath"] ?? positional[0]];
    destination = named["-destination"] ?? positional[named["-path"] ? 0 : 1];
  } else if (shell !== "powershell" && BASH_COPIES.has(program)) {
    const operands = segmentWords.slice(1).filter((word) => !word.startsWith("-"));
    if (operands.length < 2) return;
    destination = operands.pop();
    sources = operands;
  } else return;
  if (destination === undefined) return;
  const fromScratch = sources.some((source) => source && isScratch(source, context));
  if (fromScratch && !isAllowedTarget(destination, context)) {
    reasons.add(`${program} pliku roboczego do ${describeTarget(destination, context)}`);
  }
}

const ASSIGN_KEYWORDS = new Set(["export", "local", "declare", "readonly", "typeset"]);
const PS_ASSIGNMENT = /^\s*\$([\w:]+)\s*=\s*([\s\S]*?)\s*$/;
const PS_QUOTED = /^(?:'[^']*'|"[^"]*")$/;

/**
 * Records a variable the segment assigns a literal (`X=src/a.ts`, `export X=..`,
 * `$x = 'src\a.ts'`) in `context.vars`; any other assignment forgets the variable.
 */
function collectAssignments(segment, shell, context) {
  if (shell === "cmd") return;
  if (shell === "powershell") {
    const match = PS_ASSIGNMENT.exec(segment.raw);
    if (!match || /^[=~]/.test(match[2])) return;
    const name = match[1].toLowerCase();
    const rest = match[2];
    if (rest === "" && segment.expr) context.vars.set(name, segment.expr);
    else if (PS_QUOTED.test(rest)) context.vars.set(name, parseWords(rest, shell)[0] ?? "");
    else if (/^\$[\w:]+$/.test(rest)) context.vars.set(name, rest);
    else if (rest !== "" && !/^\d+(?:\.\d+)?$/.test(rest)) context.vars.set(name, `(${rest})`);
    else context.vars.delete(name);
    return;
  }
  const words = parseWords(segment.raw, shell);
  while (words.length > 0 && (ASSIGN_KEYWORDS.has(words[0]) || /^-\w+$/.test(words[0])))
    words.shift();
  const assignments = words.map((word) => /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(word));
  // `X=1 command` is a variable for that command only, not an assignment.
  if (assignments.length === 0 || assignments.some((match) => match === null)) return;
  assignments.forEach((match, index) => {
    const last = index === assignments.length - 1;
    const value = match[2] === "" && last && segment.expr ? segment.expr : match[2];
    context.vars.set(match[1].toLowerCase(), value);
  });
}

/** Checks one segment; updates `context.inScratch` after `cd`. */
function checkSegment(segment, shell, context, bodies, reasons, depth) {
  checkRedirects(segment, shell, context, reasons);
  collectAssignments(segment, shell, context);

  for (const match of segment.masked.matchAll(DOTNET_WRITES)) {
    const target = writeCallTarget(segment.raw, match, "first");
    if (target === null || !isAllowedTarget(target, context)) {
      reasons.add(
        `zapis .NET (${match[0].replace(/\s*\($/, "")}${target ? ` → "${target}"` : ""})`,
      );
    }
  }

  const segmentWords = withoutPrefixes(parseWords(segment.raw, shell));
  if (segmentWords.length === 0) return;
  // An expression glued to the previous word (`/tmp/$(date)`) is part of that word.
  if (segment.expr && !segment.glued) segmentWords.push(segment.expr);
  const program = programName(segmentWords[0]);
  const label = segmentWords[0];
  const blockTargets = (targets, name) => {
    for (const target of targets) {
      if (!isAllowedTarget(target, context))
        reasons.add(`${name} → ${describeTarget(target, context)}`);
    }
  };

  if (CHANGE_DIRECTORY.has(program)) {
    const target = segmentWords.slice(1).find((word) => !word.startsWith("-"));
    context.inScratch = target !== undefined && isScratch(target, context);
    return;
  }
  if (checkNestedShell(program, segmentWords, segment, bodies, shell, depth, reasons)) return;
  checkCopy(program, segmentWords, shell, context, reasons);

  const psAlias = shell === "powershell" && ["sc", "ac", "tee"].includes(program);
  if (program === "tee" && !psAlias) {
    blockTargets(
      segmentWords.slice(1).filter((word) => !word.startsWith("-")),
      "tee",
    );
  } else if (program === "tee-object" || (psAlias && program === "tee")) {
    const { named } = psArguments(segmentWords);
    if (!("-variable" in named) || "-filepath" in named) {
      blockTargets(psWriteTargets(segmentWords), label);
    }
  } else if (["set-content", "add-content", "out-file"].includes(program) || psAlias) {
    const targets = psWriteTargets(segmentWords);
    if (targets.length === 0) reasons.add(`${label} bez podanego pliku docelowego`);
    blockTargets(targets, label);
  } else if (program === "new-item" || program === "ni") {
    const { named } = psArguments(segmentWords);
    if (Object.keys(named).some((name) => /^-va(?:l(?:u(?:e)?)?)?$/.test(name))) {
      blockTargets(psWriteTargets(segmentWords), `${label} -Value`);
    }
  } else if (program === "sed") {
    blockTargets(sedTargets(segmentWords) ?? [], "sed -i");
  } else if (program === "dd") {
    const output = segmentWords.find((word) => word.startsWith("of="));
    if (output) blockTargets([output.slice(3)], "dd");
  } else if (program === "perl" && perlTargets(segmentWords) !== null) {
    blockTargets(perlTargets(segmentWords), "perl -i");
  }

  if (INTERPRETERS.has(program)) {
    const code = [segment.raw, ...(segment.raw.includes("<<") ? bodies : [])].join("\n");
    checkScriptWrites(code, program, context, reasons);
  }
}

/**
 * Reasons to block the command (an empty list lets it through).
 * `shell` is "bash", "powershell" or "cmd".
 */
export function findShellFileWrites(command, shell = "bash", depth = 0) {
  if (typeof command !== "string" || depth > MAX_DEPTH) return [];
  const reasons = new Set();
  const { text, bodies } = stripHeredocs(joinContinuations(command));
  const quoted = maskQuoted(text, shell);
  let { masked } = quoted;
  if (shell === "bash") masked = masked.replace(BASH_COMPARISONS, (m) => FILL.repeat(m.length));
  const context = { inScratch: false, vars: new Map() };

  for (const segment of segmentsOf(quoted.cleaned, masked)) {
    checkSegment(segment, shell, context, bodies, reasons, depth);
  }
  return [...reasons];
}

/** The shell dialect of a Claude Code tool. */
export function shellOf(toolName) {
  return toolName === "PowerShell" ? "powershell" : "bash";
}

export function blockMessage(reasons) {
  return [
    `Zablokowano zapis do pliku z powłoki: ${reasons.join("; ")}.`,
    "Pliki w repozytorium zmieniaj narzędziami Edit/Write (wtedy działają hooki, które je pilnują).",
    "Logi, notatki i pliki pomocnicze zapisuj w `.ai/tmp/` swojego worktree albo w katalogu tymczasowym systemu (scratchpad, `$env:TEMP`, `/tmp`).",
    "Dozwolone są też przekierowania strumieni (`2>&1`, `2>/dev/null`, `>$null`) i narzędzia formatujące (`npx prettier --write`, `eslint --fix`).",
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
    process.stderr.write("block-shell-file-writes: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const reasons = findShellFileWrites(event?.tool_input?.command, shellOf(event?.tool_name));
  if (reasons.length > 0) {
    process.stderr.write(`${blockMessage(reasons)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
