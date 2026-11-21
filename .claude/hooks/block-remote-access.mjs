#!/usr/bin/env node
// PreToolUse hook (Claude Code): blocks shell commands that reach a remote
// server, SSH keys or local secrets when the command text says so.
//
// Git that may talk to a server is checked against an ALLOW LIST, not a list
// of forbidden forms (since version 4; every list of forbidden forms so far
// had a bypass). The command is read the way a shell reads it (quotes,
// escapes, separators, subshells, redirections, Bash brace expansion
// `{a,b}`/`{a..c}`; Bash, PowerShell and, when `cmd` appears, cmd rules) and
// every word that runs git starts a git command, wherever it stands in the
// command (`git`, a path to git such as `C:\…\git.exe`). Exceptions (version
// 5): a bare `git` in the arguments of a search program (`rg git docs`,
// `Select-String git`), of a print program whose output goes nowhere (`echo
// git push`; not into a pipe, `$(…)`, `<(…)` or a file, and with no
// interpreter in the text) and right after a git command (`git grep -n git`)
// is a word, not a command. Quoted text is one word, so a commit message or
// a PR title that mentions `git push` is not a command; the quoted command of
// an interpreter (`bash -c`, `powershell -c`, `cmd /c`, `source`,
// `Start-Process`, …) and, with an interpreter in the text, a quoted text at
// the start of a command or in a redirection (`'…' | powershell -c -`,
// `bash <<< '…'`) is read again as a command. `iex`/`Invoke-Expression` in a
// command text with git is blocked (its text may be assembled), and so is
// git without a subcommand behind `xargs`, `find -exec`, `Start-Process`
// (version 6).
// - Network subcommands pass only in these forms (`-C <path>` is the only
//   global option allowed before them):
//     git fetch [-q|--prune|--all|--depth <n>|…] [origin [<ref>…]]
//     git pull  [-q|--ff-only|--no-edit|--rebase|--no-rebase|…] [origin [<ref>]]
//     git push  [-u|-q|-n|--force-with-lease|…] origin <ref without : and +>
//     git ls-remote [--heads|--tags|…] [origin [<ref>…]]
//     git remote [-v] | get-url [--push|--all] origin | show origin
//     git clone [-q|--depth <n>|-b <ref>|…] https://github.com/<owner>/<repo> [<dir>]
//     git submodule [status|summary …], git lfs ls-files|status|version|env
//   Anything else from this group is blocked: other remotes, addresses,
//   options (also abbreviations), `-c`/`--config-env`/other global options,
//   a `GIT_*` variable in the same command, a redirection glued to a word,
//   a brace right after the subcommand (`git fetch {host:x,main}`),
//   arguments appended by `xargs`/`find -exec`, `git archive --remote`,
//   fetch-pack, send-pack, request-pull, subtree, `git-<network command>`,
//   `scalar clone` and an unknown subcommand (an alias).
// - `git config` passes only as a read (`--get`, `--get-all`, `--get-regexp`,
//   `--list`, `-l`, `get`, `list`, a key alone; output format and type
//   options such as `-z`, `--show-origin`, `--bool` do not make a read) or
//   as a write of an
//   allowed key (`user.name`, `user.email`, `core.autocrlf`, `pull.rebase`,
//   `advice.*`; `remote.origin.url` only to `https://github.com/…`); any
//   other option (also an abbreviation such as `--fil`) or key is blocked.
//   `-c <key>=…` before a subcommand: only the allowed keys.
// - Local subcommands (status, log, diff, show, commit, merge, switch, branch,
//   worktree, add, stash, rev-parse, grep, …) pass, except the beginning of
//   a long option that runs a program or loads settings (`--exec`,
//   `--extcmd`, `--upload-pack`, `--receive-pack`, `--config`, `--template`,
//   `--separate-git-dir`, `--open-files-in-pager`; git accepts `--exe`,
//   `--ext`, …), `difftool -x`, `grep -O`, `bisect run`, `filter-branch` and
//   `mergetool`. The command of `rebase -x`/`--exec` (any abbreviation) is
//   read again as a command.
// - Anywhere in the text: `GIT_CONFIG*`, `GIT_SSH*`, `GIT_PROXY*`,
//   `GIT_EXEC_PATH`, `GIT_ASKPASS`, `--config-env`, `core.sshCommand`,
//   `insteadOf`, `uploadpack`, `receivepack`, `ext::`; an assignment of
//   `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`,
//   `PAGER`, `EDITOR`, `VISUAL` other than empty, `true` or `cat`.
// Other checks (kept from version 3):
// - SSH clients and relatives (ssh, scp, sftp, slogin, ssh-add, ssh-agent,
//   ssh-copy-id, ssh-keygen, ssh-keyscan, sshpass, sshfs, sshuttle, autossh,
//   mosh, dbclient, `ssh-remote+` of VS Code), rsync, rclone, PuTTY tools
//   (plink, pscp, psftp, putty), WinSCP and any `user@host:path` address;
// - PowerShell remoting (Enter-PSSession, New-PSSession, Invoke-Command, …,
//   `-HostN…`/`-SSH…`, `HostName =` in a splatting table) and
//   `powershell -EncodedCommand` (any abbreviation);
// - the `.ssh` folder (also `.s*`, `.ss?`), the folder with deployment secrets
//   (`krajozbior-deploy`, also `krajozbior-d*`, `krajozbior*`) and the local
//   showcase data (`.data/showcase`, `showcase/outbox`, a wildcard in `.data`,
//   a recursive read of `.data`: `-r`, `-rnIi`, `-alhR`, `-Recurse`, `-s`,
//   `/s`, `--no-index`, rg, tree, …). Creating the showcase folders
//   (`New-Item -ItemType Directory`, `mkdir`) and `Test-Path` are allowed when
//   the command has no redirection or command substitution; `.data/deploy/`
//   (reports for the agent) is allowed.
// Deployment runs only in the owner's own PowerShell window (`wdroz.ps1`; E11
// spec, D-E11-4; security-notes.md).
//
// Speed: every regular expression is linear (fixed words, lookarounds and
// bounded repetition); the command is read in one pass per shell, a git
// command stops at its first problem and scans at most 256 arguments. A
// 100 kB command takes milliseconds; the test checks it.
//
// Known limitations (the test lists them): the hook reads the command text
// only, it does not run a shell. It does not stop
// - a name or an argument assembled at run time (variables, base64 outside
//   `-EncodedCommand`) or a wildcard in a program name, and obscured names of
//   git: `$'git'`, `& ('git')`, a relative path `bin/git`, `Set-Alias g git`,
//   `npx -c '…'`;
// - a script file run with `-File`, another interpreter (`node -e` with
//   child_process, `python -c "import paramiko"`);
// - git settings prepared outside the command: `~/.gitconfig`, `.git/config`
//   or `.gitmodules` edited with a file tool (then `origin` or `-C <repo>` may
//   point elsewhere) and programs that git runs locally (`core.pager`,
//   `core.fsmonitor`, `diff.external`);
// - other wildcard paths to keys and secrets and reaching a protected folder
//   step by step (`cd .data; cd showcase; cat outbox/x`) or from a parent.
// It is a guard against accidental use, not a security boundary: that is the
// deployment passphrase the agent does not know.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event, an
// event without a command text, a missing `lib/shell-text.mjs` or an internal
// error also exits 2: a security hook blocks when it cannot read the command.
// It does not block when Node is missing or the hook runs past its time limit
// (Claude Code treats both as a non-blocking error); the linear reading keeps
// it far below the limit.
import { pathToFileURL } from "node:url";

// Loaded dynamically: a static import of a missing module ends Node with exit
// code 1, which does not block. Without the module `main` refuses (exit 2).
let shellText = null;
try {
  shellText = await import("./lib/shell-text.mjs");
} catch {
  shellText = null;
}

// ---------------------------------------------------------------------------
// Whole-text patterns (each linear).

const REMOTE_TOOL =
  /(?<![A-Za-z0-9_.-])(?:ssh-copy-id|ssh-keyscan|ssh-keygen|ssh-agent|ssh-add|ssh-remote|sshpass|sshfs|sshuttle|autossh|slogin|ssh|scp|sftp|mosh|dbclient|rsync|rclone|plink|pscp|psftp|putty|winscp)(?:\.exe|\.com)?(?![A-Za-z0-9_-]|\.[A-Za-z0-9_-])/gi;
const SSH_DIR = /(?<![A-Za-z0-9_.-])\.ssh(?![A-Za-z0-9])/gi;
const SSH_DIR_WILDCARD = /(?<![A-Za-z0-9_.-])\.s(?:sh?)?[*?[{]/gi;
// `krajozbior-dep…` or a wildcard right after `krajozbior`, `krajozbior-`,
// `krajozbior-d`, `krajozbior-de` (`krajozbior-bot[bot]` and the repository
// folder `krajozbior\*.json` pass).
const DEPLOY_DIR = /krajozbior-dep|(?<![A-Za-z0-9])krajozbior(?:-(?:de?)?)?[*?[{]/gi;
// Git settings and options that start SSH, run a command for a remote or
// rewrite a remote address.
const GIT_TRANSPORT =
  /git_ssh|git_proxy|sshcommand|ssh\.variant|gitproxy|insteadof|uploadpack|receivepack|--(?:upload|receive)-pack|(?<![\w-])ext::/gi;
// Git settings passed through the environment (B4): never needed by the agent.
const GIT_ENVIRONMENT =
  /(?<![A-Za-z0-9])git_(?:config|ssh|proxy|exec_path|askpass)\w{0,64}|--config-env/gi;
// `user@host:` (scp-like remote of git, rsync, scp). The user part may not
// follow `:` or `/`, so `scheme://user:pass@localhost:55442/db` passes.
const SCP_LIKE_REMOTE = /(?<![\w.+%:/-])[\w.+%-]+@([\w.-]+|\[[^\]\s]{0,64}\]):/g;
// `pkg@npm:x`, `image@sha256:…` are not hosts.
const NOT_A_HOST = new Set(["npm", "sha256", "sha512", "file", "link", "workspace", "patch"]);
const PS_REMOTING_CMDLET =
  /(?<![\w-])(?:Enter-PSSession|New-PSSession|Connect-PSSession|Receive-PSSession|Invoke-Command|etsn|nsn|cnsn|rcsn|icm)(?![\w-])/gi;
const PS_REMOTING_PARAM = /(?<![\w-])-(?:HostN|SSH)\w*/gi;
// `@{HostName=…}`, `; HostName =`, `$p.HostName =`, `$p[HostName]=`; not
// `HOSTNAME=0.0.0.0 node …` at the start of a command and not `.hostname ===`.
const PS_REMOTING_SPLAT =
  /[{;.[][ \t]{0,8}(?:HostName|SSHTransport|SSHConnection)\]?[ \t]{0,8}=(?!=)/gi;

const TEXT_PATTERNS = [
  REMOTE_TOOL,
  SSH_DIR,
  SSH_DIR_WILDCARD,
  DEPLOY_DIR,
  GIT_TRANSPORT,
  GIT_ENVIRONMENT,
  PS_REMOTING_CMDLET,
  PS_REMOTING_PARAM,
  PS_REMOTING_SPLAT,
];

// A program that git runs, set in a variable (version 6, B5): `GIT_EDITOR=…`,
// `export PAGER=…`, `$env:GIT_SEQUENCE_EDITOR=…`. Only an empty value, `true`
// and `cat` pass.
const PROGRAM_VARIABLE =
  /(?<![\w.-])(?:\$env:)?(?:git_editor|git_sequence_editor|git_external_diff|git_pager|pager|editor|visual)[ \t]{0,8}=/gi;
const HARMLESS_PROGRAM = new Set(["", "true", "cat"]);
const MAX_VARIABLE_VALUE = 256;

/** The value assigned at `position` (quotes removed), or null when unreadable. */
function assignedValue(text, position) {
  let start = position;
  while (text[start] === " " || text[start] === "\t") start += 1;
  const quote = text[start];
  if (quote === "'" || quote === '"') {
    const end = text.slice(start + 1, start + 1 + MAX_VARIABLE_VALUE).indexOf(quote);
    return end < 0 ? null : text.slice(start + 1, start + 1 + end);
  }
  let end = start;
  while (end < text.length && end - start <= MAX_VARIABLE_VALUE && !/[\s;&|]/.test(text[end])) {
    end += 1;
  }
  return text.slice(start, end);
}

function checkProgramVariables(text, found) {
  for (const match of text.matchAll(PROGRAM_VARIABLE)) {
    const value = assignedValue(text, match.index + match[0].length);
    if (value === null || !HARMLESS_PROGRAM.has(value.trim().toLowerCase())) {
      found.add(`${match[0].replace(/[ \t=]/g, "")} (program uruchamiany przez git)`);
    }
  }
}

// A `GIT_*` variable anywhere in a command that runs network git (`GIT_DIR`,
// `GIT_TRACE`, …): the allowed forms never need one.
const GIT_VARIABLE = /(?<![\w/.-])git_[a-z0-9_]{1,64}/i;

// ---------------------------------------------------------------------------
// Reading the command as a shell does.

/**
 * How each shell reads a command. Bash: `\` escapes, backticks and `$(…)`
 * run a command (also inside double quotes). PowerShell: a backtick escapes,
 * `$(…)` runs a command (also inside double quotes). cmd (only when the text
 * names it): `^` escapes outside double quotes, `'` is an ordinary character.
 */
const BASH = { name: "bash", escape: "\\", quotes: "'\"", backtick: true, substitution: true };
const POWERSHELL_MODE = {
  name: "powershell",
  escape: "`",
  quotes: "'\"",
  backtick: false,
  substitution: true,
};
const CMD = { name: "cmd", escape: "^", quotes: '"', backtick: false, substitution: false };
const CMD_WORD = /(?<![\w.-])cmd(?:\.exe)?(?![\w-])/i;

const COMMAND_SEPARATORS = new Set([";", "&", "|", "\r", "\n", "{", "}"]);
// A comma separates words: PowerShell passes `a,b` to a program as two
// arguments, Bash expands `{git,fetch,prod}` to three words.
const WORD_BREAK = /[\s,]/;
const FD_WORD = /^(?:\d+|\*)$/;
const FD_DUPLICATE = /[\d-]/;
// Runs of characters that mean nothing special in any of the shells (read in
// one step instead of one character at a time): outside quotes, inside single
// quotes and inside double quotes.
const PLAIN_RUN = /[^\s,;&|{}()<>'"`\\^$]+/y;
const SINGLE_QUOTED_RUN = /[^']+/y;
const DOUBLE_QUOTED_RUN = /[^"`\\^$]+/y;

/**
 * Simple commands of a text as `{ words, targets, glued }`: the words without
 * quotes, the targets of redirections (not words of the command) and whether
 * a redirection is glued to a word (`ls-remote>out.txt`). A subshell
 * (`$(…)`, `(…)`, backticks) is a command of its own; in the outer word it
 * leaves `$()`. One pass.
 */
function tokenize(text, mode) {
  const commands = [];
  const stack = [];
  const newFrame = (kind) => ({
    kind,
    words: [],
    targets: [],
    hereStrings: [],
    glued: false,
    brace: false,
    feeds: kind !== null,
    word: null,
    quote: null,
    target: false,
    hereString: false,
    first: commands.length,
  });
  let frame = newFrame(null);

  const endWord = () => {
    if (frame.word !== null) {
      if (frame.target) {
        frame.targets.push(frame.word);
        if (frame.hereString) frame.hereStrings.push(frame.word);
      } else frame.words.push(frame.word);
      frame.target = false;
      frame.hereString = false;
    }
    frame.word = null;
  };
  const endCommand = (pipe = false) => {
    endWord();
    if (frame.words.length > 0 || frame.targets.length > 0) {
      commands.push({
        words: frame.words,
        targets: frame.targets,
        hereStrings: frame.hereStrings,
        glued: frame.glued,
        brace: frame.brace,
        // Its output goes on: into a pipe, a subshell (`$(…)`, `<(…)`).
        feeds: frame.feeds || pipe,
      });
    }
    frame.words = [];
    frame.targets = [];
    frame.hereStrings = [];
    frame.glued = false;
    frame.brace = false;
    frame.feeds = frame.kind !== null;
    frame.target = false;
    frame.hereString = false;
  };
  const open = (kind) => {
    stack.push(frame);
    frame = newFrame(kind);
  };
  const close = () => {
    endCommand();
    // `$(git branch --show-current)` gives the current branch name: a word of
    // its own that `git push origin <branch>` accepts (version 6, S2).
    const inner = commands.slice(frame.first);
    const branch =
      inner.length === 1 &&
      inner[0].targets.length === 0 &&
      CURRENT_BRANCH_COMMANDS.has(inner[0].words.join(" "));
    frame = stack.pop();
    frame.word = `${frame.word ?? ""}${branch ? CURRENT_BRANCH : "$()"}`;
  };
  // `2>x`, `*>x` (a stream number), `>x`, `>>x`, `<x`, `>&2`, `2>&1`, `>|x`.
  const redirect = (i) => {
    if (frame.word !== null) {
      if (FD_WORD.test(frame.word) && !frame.target) frame.word = null;
      else {
        frame.glued = true;
        endWord();
      }
    }
    let j = i;
    while (j < text.length && (text[j] === "<" || text[j] === ">")) j += 1;
    // `<<<` is a here-string: its word is the standard input of the command.
    frame.hereString = text.startsWith("<<<", i);
    let target = true;
    if (text[j] === "&") {
      j += 1;
      if (FD_DUPLICATE.test(text[j] ?? "")) {
        target = false;
        while (j < text.length && FD_DUPLICATE.test(text[j])) j += 1;
      }
    } else if (text[j] === "|") j += 1;
    frame.target = target;
    return j - 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const run =
      frame.quote === null
        ? PLAIN_RUN
        : frame.quote === "'"
          ? SINGLE_QUOTED_RUN
          : DOUBLE_QUOTED_RUN;
    run.lastIndex = i;
    const plain = run.exec(text);
    if (plain !== null) {
      frame.word = (frame.word ?? "") + plain[0];
      i += plain[0].length - 1;
      continue;
    }
    const char = text[i];
    if (frame.quote === "'") {
      if (char === "'") frame.quote = null;
      else frame.word += char;
    } else if (
      char === mode.escape &&
      i + 1 < text.length &&
      !(mode === CMD && frame.quote === '"')
    ) {
      frame.word = (frame.word ?? "") + text[i + 1];
      i += 1;
    } else if (mode.backtick && char === "`") {
      if (frame.kind === "`") close();
      else open("`");
    } else if (mode.substitution && char === "$" && text[i + 1] === "(") {
      open("(");
      i += 1;
    } else if (frame.quote === '"') {
      if (char === '"') frame.quote = null;
      else frame.word += char;
    } else if (mode.quotes.includes(char)) {
      frame.quote = char;
      frame.word ??= "";
    } else if (char === "(") open("(");
    else if (char === ")") {
      if (frame.kind === "(") close();
      else endCommand();
    } else if (COMMAND_SEPARATORS.has(char)) {
      // `{` in the middle of a command or a brace glued to a word is Bash
      // brace expansion (`git fetch {host:x,main}`), not a group: the command
      // before it is marked (a network git command with it is blocked).
      if (
        (char === "{" && (frame.word !== null || frame.words.length > 0)) ||
        (char === "}" && frame.word !== null)
      ) {
        frame.brace = true;
      }
      // A single `|` (not `||`) passes the output to the next command.
      endCommand(char === "|" && text[i + 1] !== "|" && text[i - 1] !== "|");
    } else if (char === "<" || char === ">") i = redirect(i);
    else if (WORD_BREAK.test(char)) endWord();
    else frame.word = (frame.word ?? "") + char;
  }
  while (stack.length > 0) close();
  endCommand();
  return commands;
}

// Bash brace expansion: an innermost `{a,b}` or `{a..c}` (no spaces, quotes,
// `$` or `\` inside) turns its word into one word per item
// (`.data/{showcase,x}/y` → `.data/showcase/y .data/x/y`). `${x}` is not one.
const BRACE_GROUP = /\{([^{}\s'"`$\\]{0,256})\}/g;
const BRACE_SEQUENCE = /^(-?\d{1,6}|[A-Za-z])\.\.(-?\d{1,6}|[A-Za-z])(?:\.\.-?\d{1,6})?$/;
const BRACE_WORD_END = /[\s;&|<>()]/;
const MAX_BRACE_STEPS = 32;
const MAX_BRACE_ITEMS = 64;
const MAX_BRACE_GROWTH = 16_384;
const BRACE_OVERFLOW = "zbyt wiele rozwinięć klamrowych";
const OVERFLOW = { text: null, overflow: true };

/** The items of a brace group, `null` when Bash leaves it as it is. */
function braceItems(content) {
  if (content.includes(",")) return content.split(",");
  const sequence = BRACE_SEQUENCE.exec(content);
  if (sequence === null) return null;
  const [, from, to] = sequence;
  const numbers = /\d/.test(from) && /\d/.test(to);
  if (!numbers && (/\d/.test(from) || /\d/.test(to))) return null;
  const start = numbers ? Number(from) : from.charCodeAt(0);
  const end = numbers ? Number(to) : to.charCodeAt(0);
  if (Math.abs(end - start) >= MAX_BRACE_ITEMS) return [];
  const items = [];
  const step = start <= end ? 1 : -1;
  for (let value = start; value !== end + step; value += step) {
    items.push(numbers ? String(value) : String.fromCharCode(value));
  }
  return items;
}

/**
 * The text after Bash brace expansion: `{ text, overflow }`, or null when
 * the text has nothing to expand. At most 32 groups, 64 items in a group and
 * 16 384 added characters are expanded; more is an overflow (`text: null`,
 * the command is blocked without reading the expansion).
 */
let lastBraceText = null;
let lastBraceResult = null;

function expandBraces(text) {
  if (!text.includes("{") || !text.includes("}")) return null;
  // The whole command is expanded twice (patterns and words): reuse it.
  if (text !== lastBraceText) {
    lastBraceText = text;
    lastBraceResult = expandBracesOnce(text);
  }
  return lastBraceResult;
}

function expandBracesOnce(text) {
  let current = text;
  let changed = false;
  for (let step = 0; step <= MAX_BRACE_STEPS; step += 1) {
    let group = null;
    for (const match of current.matchAll(BRACE_GROUP)) {
      if (current[match.index - 1] === "$") continue;
      const items = braceItems(match[1]);
      if (items !== null) {
        group = { start: match.index, end: match.index + match[0].length, items };
        break;
      }
    }
    if (group === null) return changed ? { text: current, overflow: false } : null;
    if (step === MAX_BRACE_STEPS || group.items.length === 0) return OVERFLOW;
    let start = group.start;
    while (start > 0 && !BRACE_WORD_END.test(current[start - 1])) start -= 1;
    let end = group.end;
    while (end < current.length && !BRACE_WORD_END.test(current[end])) end += 1;
    const prefix = current.slice(start, group.start);
    const suffix = current.slice(group.end, end);
    const words = group.items.map((item) => prefix + item + suffix).join(" ");
    current = current.slice(0, start) + words + current.slice(end);
    changed = true;
    if (current.length > text.length + MAX_BRACE_GROWTH) return OVERFLOW;
  }
  return OVERFLOW;
}

/**
 * The commands of a text as Bash and PowerShell read it (and cmd if named),
 * plus Bash's reading after brace expansion. `found` collects an overflow.
 */
function commandsOf(text, found) {
  const modes = CMD_WORD.test(text) ? [BASH, POWERSHELL_MODE, CMD] : [BASH, POWERSHELL_MODE];
  const commands = modes.flatMap((mode) => tokenize(text, mode));
  const expanded = expandBraces(text);
  if (expanded?.overflow) found.add(BRACE_OVERFLOW);
  else if (expanded !== null) commands.push(...tokenize(expanded.text, BASH));
  return commands;
}

const EXECUTABLE_SUFFIX = /\.(?:exe|cmd|bat|com)$/;
const EXECUTABLE_SUFFIXES = new Set([".exe", ".cmd", ".bat", ".com"]);

/**
 * The program name of a word: file name (as `baseName` of the shared module),
 * lower case, without `.exe`, `.cmd`, `.bat`, `.com`. String operations only:
 * it runs for every word of a long command.
 */
function program(word) {
  const cut = Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\"));
  const name = (cut < 0 ? word : word.slice(cut + 1)).toLowerCase();
  return name.length > 4 && EXECUTABLE_SUFFIXES.has(name.slice(-4)) ? name.slice(0, -4) : name;
}

const QUOTES = new Set(['"', "'", "`"]);

/** The word without quotes around it (a loop, not a regular expression). */
function unquote(word) {
  let start = 0;
  let end = word.length;
  while (start < end && QUOTES.has(word[start])) start += 1;
  while (end > start && QUOTES.has(word[end - 1])) end -= 1;
  return word.slice(start, end);
}

// ---------------------------------------------------------------------------
// Git: an allow list for everything that may reach a server.

const MAX_GIT_ARGUMENTS = 256;
// More git commands than this in one command text (counted in every reading)
// is not everyday work: blocked without reading further.
const MAX_GIT_COMMANDS = 1000;
const MAX_DEPTH = 4;

const GIT_GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const GIT_GLOBAL_FLAGS = new Set([
  "--no-pager",
  "-P",
  "-p",
  "--paginate",
  "--no-replace-objects",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--no-optional-locks",
  "--bare",
  "--no-lazy-fetch",
  "--no-advice",
  "--version",
  "-v",
  "--help",
  "-h",
  "--exec-path",
  "--html-path",
  "--man-path",
  "--info-path",
]);

// Subcommands that never reach a server and never run a program named in the
// command (rebase, difftool and filter-branch are checked for that below).
const GIT_LOCAL = new Set(
  (
    "add am annotate apply bisect blame branch bugreport bundle cat-file check-attr " +
    "check-ignore check-mailmap check-ref-format checkout cherry cherry-pick clean " +
    "column commit commit-graph commit-tree count-objects describe diagnose diff " +
    "diff-files diff-index diff-tree difftool fast-export fast-import filter-branch " +
    "for-each-ref format-patch fsck gc get-tar-commit-id grep hash-object help " +
    "index-pack init interpret-trailers log ls-files ls-tree mailinfo mailsplit " +
    "merge merge-base merge-file merge-tree mergetool mktag mktree multi-pack-index " +
    "mv name-rev notes pack-objects pack-refs patch-id prune prune-packed range-diff " +
    "read-tree rebase reflog refs replace repack rerere reset restore rev-list " +
    "rev-parse revert rm shortlog show show-branch show-index show-ref sparse-checkout " +
    "stash status stripspace switch symbolic-ref tag unpack-objects update-index " +
    "update-ref var verify-commit verify-pack verify-tag version whatchanged worktree " +
    "write-tree"
  ).split(" "),
);
// Subcommands that may reach a server (checked by the allow list or blocked).
const GIT_NETWORK = new Set([
  "fetch",
  "pull",
  "push",
  "ls-remote",
  "clone",
  "remote",
  "submodule",
  "lfs",
  "fetch-pack",
  "send-pack",
  "request-pull",
  "subtree",
]);
// `git-<name>` programs that reach a server or run a configured program.
const GIT_DASHED_NETWORK = new Set([
  ...GIT_NETWORK,
  "archive",
  "config",
  "upload-pack",
  "receive-pack",
  "upload-archive",
  "http-fetch",
  "http-push",
  "for-each-repo",
  "daemon",
  "shell",
]);
const SCALAR_NETWORK = new Set(["clone", "register", "run", "reconfigure", "fetch"]);

const REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,200}$/;
const FETCH_REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,200}(?::[A-Za-z0-9_][A-Za-z0-9._/-]{0,200})?$/;
const LS_REF = /^[A-Za-z0-9_*][A-Za-z0-9._/*-]{0,200}$/;
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/?$/;
const COUNT = /^\d{1,6}$/;
const isCount = (value) => COUNT.test(value);
const isRef = (value) => REF.test(value);
const isOrigin = (word) => word === "origin";
// The word left by `$(git branch --show-current)` (see `tokenize`): git
// prints a branch name, which has no `:` and does not start with `+`.
const CURRENT_BRANCH = "$(current-branch)";
const CURRENT_BRANCH_COMMANDS = new Set([
  "git branch --show-current",
  "git rev-parse --abbrev-ref HEAD",
]);
const isPushRef = (word) => isRef(word) || word === CURRENT_BRANCH;

const DEPTH = new Map([["--depth", isCount]]);
const GIT_ALLOW_LIST = {
  fetch: {
    flags: new Set([
      "-q",
      "--quiet",
      "-p",
      "--prune",
      "--all",
      "--tags",
      "--no-tags",
      "-v",
      "--verbose",
      "--dry-run",
      "--progress",
      "--no-progress",
      "--no-edit",
      "--ff-only",
    ]),
    shorts: "qpv",
    values: DEPTH,
    positional: (n, word) => (n === 0 ? isOrigin(word) : n <= 8 && FETCH_REF.test(word)),
    minimum: 0,
  },
  pull: {
    flags: new Set([
      "-q",
      "--quiet",
      "--prune",
      "--all",
      "--no-edit",
      "--ff-only",
      "--ff",
      "--no-ff",
      "--rebase",
      "--no-rebase",
      "--autostash",
      "--no-autostash",
      "-v",
      "--verbose",
    ]),
    shorts: "qv",
    values: DEPTH,
    positional: (n, word) => (n === 0 ? isOrigin(word) : n === 1 && isRef(word)),
    minimum: 0,
  },
  push: {
    flags: new Set([
      "-u",
      "--set-upstream",
      "-q",
      "--quiet",
      "-v",
      "--verbose",
      "-n",
      "--dry-run",
      "--force-with-lease",
      "--recurse-submodules=check",
      "--recurse-submodules=no",
      "--progress",
      "--porcelain",
    ]),
    shorts: "uqvn",
    values: new Map(),
    positional: (n, word) => (n === 0 ? isOrigin(word) : n === 1 && isPushRef(word)),
    minimum: 2,
  },
  "ls-remote": {
    flags: new Set([
      "--heads",
      "--branches",
      "--tags",
      "--refs",
      "-q",
      "--quiet",
      "--exit-code",
      "--symref",
      "-h",
      "-t",
      "-b",
    ]),
    shorts: "qhtb",
    values: new Map(),
    positional: (n, word) => (n === 0 ? isOrigin(word) : n <= 8 && LS_REF.test(word)),
    minimum: 0,
  },
  clone: {
    flags: new Set([
      "-q",
      "--quiet",
      "--single-branch",
      "--no-single-branch",
      "--no-tags",
      "--progress",
    ]),
    shorts: "q",
    values: new Map([
      ["--depth", isCount],
      ["-b", isRef],
      ["--branch", isRef],
    ]),
    positional: (n, word) => (n === 0 ? GITHUB_URL.test(word) : n === 1 && !word.startsWith("-")),
    minimum: 1,
  },
};

const REMOTE_ALLOWED = new Set([
  "",
  "-v",
  "--verbose",
  "get-url origin",
  "get-url --push origin",
  "get-url --all origin",
  "show origin",
]);
const SUBMODULE_LOCAL = new Set(["status", "summary"]);
const LFS_LOCAL = new Set(["ls-files", "status", "version", "env"]);

/** The problem word of an allow-listed command, or null when it passes. */
function checkAllowList(rule, words, from) {
  if (words.length - from > MAX_GIT_ARGUMENTS) return "(zbyt wiele argumentów)";
  let count = 0;
  for (let k = from; k < words.length; k += 1) {
    const word = words[k];
    if (word.startsWith("-") && word.length > 1) {
      if (rule.flags.has(word)) continue;
      const eq = word.indexOf("=");
      const name = eq < 0 ? word : word.slice(0, eq);
      const test = rule.values.get(name);
      if (test !== undefined) {
        const value = eq < 0 ? words[k + 1] : word.slice(eq + 1);
        if (eq < 0) k += 1;
        if (value === undefined || !test(value)) return word;
        continue;
      }
      if (!word.startsWith("--") && [...word.slice(1)].every((c) => rule.shorts.includes(c))) {
        continue;
      }
      return word;
    }
    if (!rule.positional(count, word)) return word;
    count += 1;
  }
  return count < rule.minimum ? "(brak origin i gałęzi)" : null;
}

function checkRemote(words, from) {
  if (words.length - from > 3) return words[from];
  const text = words.slice(from).join(" ");
  return REMOTE_ALLOWED.has(text) ? null : text;
}

function checkSubmodule(words, from) {
  let k = from;
  while (k < words.length && (words[k] === "-q" || words[k] === "--quiet")) k += 1;
  const action = words[k];
  return action === undefined || SUBMODULE_LOCAL.has(action) ? null : action;
}

function checkNetwork(subcommand, words, from) {
  const rule = GIT_ALLOW_LIST[subcommand];
  if (rule !== undefined) return checkAllowList(rule, words, from);
  if (subcommand === "remote") return checkRemote(words, from);
  if (subcommand === "submodule") return checkSubmodule(words, from);
  if (subcommand === "lfs") {
    const action = words[from];
    return action === undefined || LFS_LOCAL.has(action) ? null : action;
  }
  return "(niedozwolone)";
}

// The only keys the agent may set (`git config`, `git -c`): its identity and
// harmless preferences. Any other key may choose a server, run a program or
// load more settings, so writing it is blocked (version 5: an allow list
// instead of a list of dangerous keys).
const CONFIG_ALLOWED_KEY =
  /^(?:user\.(?:name|email)|core\.autocrlf|pull\.rebase|advice\.[a-z0-9-]{1,64})$/i;

function configKey(value) {
  const eq = value.indexOf("=");
  return eq < 0 ? value : value.slice(0, eq);
}

// `git config` options by their full name only: git accepts any unambiguous
// beginning (`--fil`, `--typ`), which is not here and so is blocked.
// Only these make a read (version 6, B1): `git config -z <key> <value>` is a
// write, the output format options below do not change that.
const CONFIG_READ_FLAGS = new Set(["--get", "--get-all", "--get-regexp", "-l", "--list"]);
// Output format and value type: neither a read nor a write by themselves.
const CONFIG_NEUTRAL_FLAGS = new Set([
  "--show-origin",
  "--show-scope",
  "--name-only",
  "--show-names",
  "--all",
  "--regexp",
  "-z",
  "--null",
  "--bool",
  "--int",
  "--bool-or-int",
  "--path",
  "--expiry-date",
  "--no-type",
]);
const CONFIG_TYPES = new Set(["bool", "int", "bool-or-int", "path", "expiry-date", "color"]);
const CONFIG_READ_WITH_VALUE = new Set(["-f", "--file", "--blob"]);
const CONFIG_WRITE_FLAGS = new Set(["--add", "--unset", "--unset-all"]);
const CONFIG_SCOPE_FLAGS = new Set(["--global", "--local", "--worktree", "--system"]);
const CONFIG_WRITE_VERBS = new Set(["set", "unset"]);
const CONFIG_READ_VERBS = new Set(["get", "list"]);

/**
 * `git config` passes only as a read or as a write of an allowed key: the
 * problem (an option or a key), or null.
 */
function checkConfig(words, from) {
  if (words.length - from > MAX_GIT_ARGUMENTS) return "(zbyt wiele argumentów)";
  let write = false;
  let read = false;
  let readOnlyOption = null;
  const positionals = [];
  for (let k = from; k < words.length; k += 1) {
    const word = words[k];
    if (word.startsWith("-") && word.length > 1) {
      const eq = word.indexOf("=");
      const name = eq < 0 ? word : word.slice(0, eq);
      if (CONFIG_READ_WITH_VALUE.has(name)) {
        if (eq < 0) k += 1;
        readOnlyOption = name;
      } else if (name === "--type") {
        const type = eq < 0 ? words[k + 1] : word.slice(eq + 1);
        if (eq < 0) k += 1;
        if (!CONFIG_TYPES.has(type)) return word;
      } else if (eq >= 0) return word;
      else if (CONFIG_READ_FLAGS.has(name)) read = true;
      else if (CONFIG_NEUTRAL_FLAGS.has(name)) continue;
      else if (CONFIG_WRITE_FLAGS.has(name)) write = true;
      else if (!CONFIG_SCOPE_FLAGS.has(name)) return word;
    } else positionals.push(word);
  }
  let keys = positionals;
  if (CONFIG_WRITE_VERBS.has(positionals[0])) {
    write = true;
    keys = positionals.slice(1);
  } else if (CONFIG_READ_VERBS.has(positionals[0])) {
    read = true;
    keys = positionals.slice(1);
  } else if (!read && positionals.length >= 2) write = true;
  if (read && write) return "(odczyt i zapis naraz)";
  if (!write) return null;
  if (readOnlyOption !== null) return readOnlyOption;
  if (keys.length === 0) return "(zapis bez klucza)";

  // The one server setting the agent needs: origin's address on GitHub over
  // HTTPS.
  if (
    keys.length === 2 &&
    keys[0].toLowerCase() === "remote.origin.url" &&
    GITHUB_URL.test(keys[1])
  ) {
    return null;
  }
  return CONFIG_ALLOWED_KEY.test(keys[0]) ? null : keys[0];
}

// Long options with which git runs a program, or loads settings or hooks from
// a path. Git accepts any unambiguous beginning of a long option (`--exe`,
// `--ext`), so a word that is the beginning of one of these (`--` and at
// least one letter) is blocked for every local subcommand; only `rebase
// --exec` (any beginning) has its command read again instead.
const GIT_DANGEROUS_LONG = [
  "--exec",
  "--extcmd",
  "--upload-pack",
  "--receive-pack",
  "--config",
  "--template",
  "--separate-git-dir",
  "--open-files-in-pager",
];
// Short options that run a program: `difftool -x <cmd>`, `grep -O<pager>`.
const GIT_DANGEROUS_SHORT = { difftool: "x", grep: "O" };
// Local subcommands that run programs as a whole (`filter-branch --*-filter`,
// `--setup`; `mergetool` runs a configured tool).
const GIT_BLOCKED_LOCAL = new Set(["filter-branch", "mergetool"]);

/** The dangerous long option a word begins (`--exe` → `--exec`), or undefined. */
function dangerousLongOption(name) {
  if (name.length < 3) return undefined;
  const lower = name.toLowerCase();
  return GIT_DANGEROUS_LONG.find((option) => option.startsWith(lower));
}

/**
 * A local subcommand that runs a program named in the command: blocked, or
 * its command read again (`git rebase --exec '…'`, `-x '…'`).
 */
function checkGitLocal(subcommand, words, from, found, ctx) {
  if (GIT_BLOCKED_LOCAL.has(subcommand)) {
    found.add(`git ${subcommand} (uruchamia programy)`);
    return;
  }
  if (subcommand === "bisect" && words[from]?.toLowerCase() === "run") {
    found.add("git bisect run (uruchamia programy)");
    return;
  }
  if (words.length - from > MAX_GIT_ARGUMENTS) {
    found.add(`git ${subcommand} (zbyt wiele argumentów)`);
    return;
  }
  const rebase = subcommand === "rebase";
  const short = GIT_DANGEROUS_SHORT[subcommand];
  for (let k = from; k < words.length; k += 1) {
    const word = words[k];
    if (word === "--") break;
    if (!word.startsWith("-") || word.length < 2) continue;
    if (word.startsWith("--")) {
      const eq = word.indexOf("=");
      const name = eq < 0 ? word : word.slice(0, eq);
      const dangerous = dangerousLongOption(name);
      if (dangerous === undefined) continue;
      // `git commit --template=<file>` only reads a message template (S2).
      if (subcommand === "commit" && dangerous === "--template") continue;
      if (rebase && "--exec".startsWith(name.toLowerCase())) {
        const value = eq < 0 ? words[k + 1] : word.slice(eq + 1);
        if (eq < 0) k += 1;
        if (value !== undefined) checkGitText(value, found, ctx);
        continue;
      }
      found.add(`git ${subcommand} ${name.slice(0, 40)}`);
      return;
    }
    if (rebase && word.includes("x")) {
      const rest = word.slice(word.indexOf("x") + 1);
      const value = rest === "" ? words[k + 1] : rest;
      if (value !== undefined) checkGitText(value, found, ctx);
    } else if (short !== undefined && word.includes(short)) {
      found.add(`git ${subcommand} ${word.slice(0, 40)}`);
      return;
    }
  }
}

/** Checks one git command starting at `start`; returns where to go on. */
function checkGitCommand(command, start, appended, supplied, found, ctx) {
  const { words } = command;
  const globals = [];
  let i = start + 1;
  while (i < words.length && words[i].startsWith("-") && words[i].length > 1) {
    if (i - start > MAX_GIT_ARGUMENTS) {
      found.add("git (zbyt wiele opcji globalnych)");
      return words.length;
    }
    const word = words[i];
    const eq = word.indexOf("=");
    const name = eq < 0 ? word : word.slice(0, eq);
    if (GIT_GLOBAL_WITH_VALUE.has(name)) {
      const value = eq < 0 ? words[i + 1] : word.slice(eq + 1);
      if (name === "-c" && value !== undefined && !CONFIG_ALLOWED_KEY.test(configKey(value))) {
        found.add(`git -c ${configKey(value).slice(0, 60)}`);
      }
      globals.push(name);
      i += eq < 0 ? 2 : 1;
    } else if (GIT_GLOBAL_FLAGS.has(word)) {
      globals.push(word);
      i += 1;
    } else {
      // Name the network subcommand behind it, if any, for the hint.
      const later = words.slice(i + 1, i + 9).find((next) => GIT_NETWORK.has(next.toLowerCase()));
      const subject = later === undefined ? "" : `${later.toLowerCase()} `;
      found.add(`git ${subject}(nieznana opcja globalna ${word.slice(0, 40)})`);
      return i + 1;
    }
  }
  if (i >= words.length) {
    // No subcommand in the text: another program supplies it (`xargs git`,
    // `xargs -I{} git {}`, `Start-Process -ArgumentList … -FilePath git`).
    if (appended || supplied || command.brace) {
      found.add("git (podpolecenie dopisuje inny program)");
    }
    return i;
  }

  const subcommand = words[i].toLowerCase();
  const from = i + 1;
  if (GIT_NETWORK.has(subcommand)) {
    ctx.network = true;
    let problem;
    if (globals.some((option) => option !== "-C")) problem = "(opcja globalna inna niż -C)";
    else if (command.glued) problem = "(przekierowanie przyklejone do słowa)";
    else if (command.brace) problem = "(nawias klamrowy: rozwinięcie powłoki)";
    else if (appended) problem = "(argumenty dopisuje inny program)";
    else problem = checkNetwork(subcommand, words, from);
    if (problem !== null) found.add(`git ${subcommand} ${problem}`);
  } else if (subcommand === "config") {
    const key = checkConfig(words, from);
    if (key !== null) found.add(`git config ${key}`);
  } else if (subcommand === "archive") {
    const end = Math.min(words.length, from + MAX_GIT_ARGUMENTS);
    for (let k = from; k < end; k += 1) {
      const word = words[k];
      const remote =
        word.startsWith("--r") ||
        word.startsWith("--e") ||
        (/^-[^-]/.test(word) && word.includes("u"));
      if (remote) {
        ctx.network = true;
        found.add(`git archive ${word.slice(0, 60)}`);
        break;
      }
    }
  } else if (GIT_LOCAL.has(subcommand)) {
    checkGitLocal(subcommand, words, from, found, ctx);
  } else {
    found.add(`git ${subcommand.slice(0, 60)} (nieznane podpolecenie)`);
  }
  return from;
}

/** A word runs a program from a path, not a relative file name like `fix/git`. */
function looksLikeProgram(word) {
  if (!/[\\/]/.test(word)) return true;
  return /^(?:[\\/.~$%]|[A-Za-z]:)/.test(word) || EXECUTABLE_SUFFIX.test(word.toLowerCase());
}

// Programs that run their arguments, or a quoted text, as a command.
const INTERPRETERS = new Set([
  "bash",
  "sh",
  "ash",
  "zsh",
  "dash",
  "ksh",
  "csh",
  "tcsh",
  "source",
  "fish",
  "busybox",
  "wsl",
  "cmd",
  "powershell",
  "pwsh",
  "iex",
  "invoke-expression",
  "eval",
  "start-process",
  "saps",
  "start",
  "su",
  "sudo",
  "runas",
  "xargs",
  "parallel",
  "watch",
  "nohup",
  "time",
  "timeout",
  "script",
  "env",
  "exec",
  "nice",
  "command",
  "call",
  "start-job",
  "sajb",
  "start-threadjob",
  "invoke-command",
  "icm",
]);
// Programs and options that append arguments to the command they run.
const APPENDING_PROGRAMS = new Set(["xargs", "parallel"]);
// Programs that take the program and its arguments as separate parameters, in
// any order (`Start-Process -ArgumentList … -FilePath git`).
const SUPPLYING_PROGRAMS = new Set(["start-process", "saps", "start"]);
// Programs that run a text built in PowerShell (`'…' | iex`, `iex $c`): with
// the word git in the command they are blocked, the text may be assembled.
const EXPRESSION_PROGRAMS = new Set(["iex", "invoke-expression"]);
const APPENDING_OPTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir", "--exec", "-x"]);
const NESTED_TEXT = /[\s;&|<>(){}`,]/;
// Programs whose arguments are data: a pattern to search for, a text to print.
// A `git` among their arguments is a word (`rg git docs`, `Select-String git`,
// `echo git push`). A printed text may become a command when the text also
// names an interpreter (`echo git fetch x | bash`), so print programs count
// only without one.
const SEARCH_PROGRAMS = new Set([
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "zgrep",
  "select-string",
  "sls",
  "findstr",
  "ag",
  "ack",
]);
const PRINT_PROGRAMS = new Set(["echo", "printf", "write-host", "write-output", "write"]);

// Whether the text names an interpreter anywhere (also in quotes: a printed
// text then counts as a command, which only blocks more).
// `.` counts as the Bash command `source` when a word of its own.
const INTERPRETER_WORD = new RegExp(
  `(?<![\\w-])(?:${[...INTERPRETERS].join("|")})(?:\\.exe)?(?![\\w-])|(?:^|[\\s;&|(])\\.(?=\\s)`,
  "i",
);

function checkGitWords(command, found, ctx) {
  const { words } = command;
  const first = words.length > 0 ? program(words[0]) : "";
  const printed = PRINT_PROGRAMS.has(first);
  // A printed text that goes on (a pipe, `$(…)`, `<(…)`, a redirection) or
  // with an interpreter in the text may be run: read it as a command
  // (version 6, B2: `echo … | source /dev/stdin`, `. <(echo …)`).
  const printedRuns =
    printed &&
    (ctx.interpreterInText || command.feeds || command.targets.length > 0 || command.glued);
  if (printedRuns && words.length > 1) checkGitText(words.slice(1).join(" "), found, ctx);
  // A search or print program runs nothing: its arguments are data.
  if (SEARCH_PROGRAMS.has(first) || (printed && !printedRuns)) return;
  if (ctx.interpreterInText) {
    // A quoted text at the start of a command or in a redirection may be the
    // input of an interpreter (B4: `'git fetch …' | iex`, `bash <<< '…'`).
    if (NESTED_TEXT.test(words[0] ?? "")) checkGitText(words[0], found, ctx);
    for (const target of command.targets) {
      if (NESTED_TEXT.test(target)) checkGitText(target, found, ctx);
    }
  }
  let appending = false;
  let supplying = false;
  let interpreter = false;
  // After a git command a bare `git` is its argument (`git grep -n git`),
  // until another program that runs commands appears.
  let afterGit = false;
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    const name = program(word);
    if (
      APPENDING_PROGRAMS.has(name) ||
      (word.startsWith("-") && APPENDING_OPTIONS.has(word.toLowerCase()))
    ) {
      appending = true;
      afterGit = false;
    }
    if (SUPPLYING_PROGRAMS.has(name)) supplying = true;
    if (INTERPRETERS.has(name) || (i === 0 && word === ".")) {
      interpreter = true;
      afterGit = false;
    }
    if (EXPRESSION_PROGRAMS.has(name)) {
      found.add(`${name} (tekst polecenia z git, może być złożony)`);
    }
    const position = i === 0 || !(afterGit && word.toLowerCase() === "git");
    if (name === "git") {
      // Every git word counts towards the limit, also an argument of git.
      ctx.gitCommands += 1;
      if (ctx.gitCommands > MAX_GIT_COMMANDS) {
        found.add("git (zbyt wiele poleceń git w jednym poleceniu)");
        return;
      }
    }
    if (name === "git" && position && looksLikeProgram(word)) {
      afterGit = true;
      i = checkGitCommand(command, i, appending, supplying, found, ctx);
      continue;
    }
    if (!position) {
      i += 1;
      continue;
    }
    if (name.startsWith("git-") && looksLikeProgram(word)) {
      const subcommand = name.slice(4);
      if (
        GIT_DASHED_NETWORK.has(subcommand) ||
        subcommand.startsWith("remote-") ||
        subcommand.startsWith("credential")
      ) {
        ctx.network = true;
        found.add(`git ${subcommand} (program ${name})`);
      }
    }
    if (name === "scalar" && SCALAR_NETWORK.has(words[i + 1]?.toLowerCase())) {
      found.add(`scalar ${words[i + 1]}`);
    }
    i += 1;
  }
  if (interpreter) {
    for (const word of words) if (NESTED_TEXT.test(word)) checkGitText(word, found, ctx);
    for (const text of command.hereStrings) {
      if (NESTED_TEXT.test(text)) checkGitText(text, found, ctx);
      // A here-string that is not literal (`bash <<< "$c"`) cannot be read.
      if (text.includes("$")) found.add("interpreter <<< (tekst niedosłowny)");
    }
  }
}

/** Reads a text passed to an interpreter as a command of its own. */
function checkGitText(text, found, ctx) {
  if (ctx.seen.has(text)) return;
  ctx.seen.add(text);
  if (ctx.depth >= MAX_DEPTH) {
    found.add("zbyt głęboko zagnieżdżone polecenie powłoki");
    return;
  }
  ctx.depth += 1;
  for (const command of commandsOf(text, found)) checkGitWords(command, found, ctx);
  ctx.depth -= 1;
}

// ---------------------------------------------------------------------------
// PowerShell `-EncodedCommand` (`-e`, `-ec`, `-en`, `-enc`, … `-encodedcommand`).

const POWERSHELL = new Set(["powershell", "pwsh"]);

function checkPowerShell(words, programs, found) {
  let i = 0;
  while (i < words.length) {
    const name = programs[i];
    i += 1;
    if (!POWERSHELL.has(name)) continue;
    // The parameters end at the next PowerShell word (checked on its own).
    for (; i < words.length && !POWERSHELL.has(programs[i]); i += 1) {
      const word = unquote(words[i]);
      if (!word.startsWith("-") && !word.startsWith("/")) continue;
      const parameter = word.slice(1).toLowerCase();
      if (parameter === "") continue;
      if (parameter === "ec" || "encodedcommand".startsWith(parameter)) {
        found.add(`${name} ${word}`);
        break;
      }
      // Everything after -Command / -File belongs to the command or script.
      if ("command".startsWith(parameter) || "file".startsWith(parameter)) break;
    }
  }
}

// ---------------------------------------------------------------------------
// `.data`: the showcase data and recursive reads of the whole folder.

const DIRECTORY_PROGRAMS = new Set(["mkdir", "md", "test-path"]);
const NEW_ITEM = new Set(["new-item", "ni"]);
const RECURSIVE_PROGRAMS = new Set([
  "rg",
  "tree",
  "find",
  "robocopy",
  "xcopy",
  "tar",
  "zip",
  "7z",
  "compress-archive",
  "du",
]);
// Unix tools: a cluster of short options with `r`/`R` reads recursively
// (`grep -rnIi`, `ls -alhR`); PowerShell parameters (`-Force`, `-First`) are
// not clusters, so for other programs only short clusters count.
const UNIX_TOOLS = new Set([
  "grep",
  "egrep",
  "fgrep",
  "ls",
  "cp",
  "mv",
  "ag",
  "ack",
  "du",
  "tree",
  "chmod",
  "chown",
  "zip",
  "tar",
  "diff",
]);
const RECURSION_FLAG =
  /^(?:-r|-s|\/s|-rec\w*|-depth\w*|--recursive|--dereference-recursive|--no-index)$/i;
const SHORT_CLUSTER = /^-[a-zA-Z]{1,3}$/;
const UNIX_CLUSTER = /^-[a-zA-Z]{1,8}$/;
const WILDCARD = /[*?[{]/;
const WORD_CHAR = /[\w.-]/;
const UNSAFE_WORD = /[<>`]|\$\(/;

function isRecursion(word, unixTool) {
  if (RECURSION_FLAG.test(word)) return true;
  if (unixTool && UNIX_CLUSTER.test(word) && /r/i.test(word)) return true;
  return SHORT_CLUSTER.test(word) && /r/i.test(word) && word.toLowerCase() !== "-raw";
}

/** Lower-case path with `/`, without `.`, empty parts and `x/..`. */
function normalizePath(word) {
  const parts = [];
  for (const part of word.toLowerCase().replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

/** Index of the first `.data` folder name in a path, or -1. */
function dataFolderIndex(path) {
  let index = path.indexOf(".data");
  while (index >= 0) {
    const before = path[index - 1];
    const after = path[index + 5];
    const startsName = before === undefined || !WORD_CHAR.test(before);
    const endsName = after === undefined || !/[\w-]/.test(after);
    if (startsName && endsName) return index;
    index = path.indexOf(".data", index + 1);
  }
  return -1;
}

/**
 * `unsafe`: the command redirects or runs a subcommand, so creating a folder
 * does not excuse it (`mkdir x > .data/showcase/…`).
 */
function checkData(words, programs, found, unsafe) {
  const first = programs[0];
  const createsDirectory =
    !unsafe &&
    !words.some((word) => UNSAFE_WORD.test(word)) &&
    (DIRECTORY_PROGRAMS.has(first) ||
      (NEW_ITEM.has(first) && words.some((word) => /(?:^|:)directory$/i.test(unquote(word)))));
  const unixTool = programs.some((name) => UNIX_TOOLS.has(name));
  let bareData = false;
  let recursion = false;

  for (const [index, raw] of words.entries()) {
    const word = unquote(raw);
    if (isRecursion(word, unixTool) || RECURSIVE_PROGRAMS.has(programs[index])) recursion = true;
    const lower = word.toLowerCase();
    if (!lower.includes(".data") && !lower.includes("showcase")) continue;
    const path = normalizePath(word);

    if (
      (path.includes(".data/showcase") || path.includes("showcase/outbox")) &&
      !createsDirectory
    ) {
      found.add(".data/showcase");
    }
    const dataIndex = dataFolderIndex(path);
    if (dataIndex < 0) continue;
    const rest = path.slice(dataIndex + 5);
    if (rest === "") bareData = true;
    else if (!rest.startsWith("/deploy/") && WILDCARD.test(rest)) found.add(".data + wildcard");
  }
  if (bareData && recursion) found.add(".data (rekurencyjnie)");
}

// ---------------------------------------------------------------------------

/**
 * Detection variants of the shared module plus the same texts without `^`,
 * which `cmd` removes like a quote (`s^sh` runs `ssh`).
 */
function variantsOf(joined) {
  const variants = shellText.detectionVariants(joined);
  return [...new Set([...variants, ...variants.map((variant) => variant.replace(/\^/g, ""))])];
}

const MAX_REFERENCE = 80;
const SEPARATOR = /[;&|\r\n(){}]/;
const WHITESPACE = /\s+/;

/**
 * Which word checks can apply at all. Read from the text without quotes,
 * escapes and `^`: removing characters only joins letters, so every reading's
 * words are covered.
 */
function relevantChecks(joined) {
  const text = joined.replace(/["'`\\^]/g, "").toLowerCase();
  return {
    git: text.includes("git") || text.includes("scalar"),
    powershell: text.includes("powershell") || text.includes("pwsh"),
    data: text.includes(".data") || text.includes("showcase"),
  };
}

/** The parts of the command that reach a server or secrets (empty = safe). */
export function findRemoteAccess(command) {
  if (typeof command !== "string") return [];

  const found = new Set();
  const joined = shellText.joinContinuations(command);
  // Bash brace expansion: the expanded text is checked like the text itself
  // (`cat .data/{showcase,x}/secrets.env`, `~/.{ssh,x}/id`).
  const expanded = expandBraces(joined);
  const texts = expanded?.text ? [joined, expanded.text] : [joined];
  if (expanded?.overflow) found.add(BRACE_OVERFLOW);
  const checks = relevantChecks(texts.join("\n"));
  const otherWordChecks = checks.powershell || checks.data;

  for (const variant of new Set(texts.flatMap(variantsOf))) {
    for (const pattern of TEXT_PATTERNS) {
      for (const match of variant.matchAll(pattern)) found.add(match[0]);
    }
    for (const match of variant.matchAll(SCP_LIKE_REMOTE)) {
      if (!NOT_A_HOST.has(match[1].toLowerCase())) found.add(match[0]);
    }
    checkProgramVariables(variant, found);
    if (!otherWordChecks) continue;
    // Plain whitespace words: a glued `>` or backtick stays visible here.
    for (const segment of variant.split(SEPARATOR)) {
      const words = segment.split(WHITESPACE).filter(Boolean);
      if (words.length === 0) continue;
      const programs = words.map(program);
      if (checks.powershell) checkPowerShell(words, programs, found);
      if (checks.data) checkData(words, programs, found, false);
    }
  }

  if (checks.git || otherWordChecks) {
    const parsedCommands = commandsOf(joined, found);
    const ctx = {
      network: false,
      depth: 0,
      seen: new Set([joined]),
      gitCommands: 0,
      interpreterInText: checks.git && texts.some((text) => INTERPRETER_WORD.test(text)),
    };
    for (const parsed of parsedCommands) {
      if (checks.git) checkGitWords(parsed, found, ctx);
      if (!otherWordChecks) continue;
      const words = parsed.targets.length > 0 ? [...parsed.words, ...parsed.targets] : parsed.words;
      const programs = words.map(program);
      if (checks.powershell) checkPowerShell(words, programs, found);
      if (checks.data) {
        checkData(words, programs, found, parsed.glued || parsed.targets.length > 0);
      }
    }
    if (ctx.network && GIT_VARIABLE.test(joined)) {
      found.add("GIT_* w poleceniu git łączącym się z serwerem");
    }
  }
  return [...new Set([...found].map((reference) => reference.slice(0, MAX_REFERENCE)))];
}

// How to do the same thing within the allow list, by the git subcommand.
const GIT_HINTS = {
  fetch: "Pobieranie: `git fetch origin` (opcje: -q, --prune, --all, --depth <liczba>).",
  pull: "Pobranie i scalenie: `git pull origin <gałąź>` (opcje: -q, --ff-only, --no-edit, --rebase, --no-rebase).",
  push: "Wysyłanie: `git push -u origin <gałąź>` albo `git push origin HEAD` (nazwa gałęzi bez `:` i `+`; samo `git push` nie przechodzi).",
  "ls-remote": "Gałęzie na serwerze: `git ls-remote origin [<gałąź>]`.",
  remote:
    "Zdalne repozytoria: tylko `git remote -v`, `git remote get-url origin`, `git remote show origin`.",
  clone: "Klonowanie: tylko `git clone https://github.com/<właściciel>/<repo>.git`.",
  config:
    "`git config`: czytanie (`--get`, `--get-all`, `--get-regexp`, `--list`) jest dozwolone; zapisywać wolno tylko `user.name`, `user.email`, `core.autocrlf`, `pull.rebase`, `advice.*`, pełnymi nazwami opcji (bez skrótów w rodzaju `--fil`).",
  "-c": "Opcja `-c` przyjmuje tylko klucze `user.name`, `user.email`, `core.autocrlf`, `pull.rebase`, `advice.*`.",
};

export function blockMessage(references) {
  const lines = [
    `Zablokowano polecenie powłoki: łączy się z serwerem albo sięga po klucze SSH lub sekrety wdrożeniowe (${references.join(", ")}).`,
    "Zasada: specyfikacja E11 (D-E11-4) i security-notes.md — wdrożenie, wgrywanie kolekcji i diagnozę uruchamia właściciel w swoim oknie PowerShell (`wdroz.ps1`).",
    "Przygotuj commit i podaj właścicielowi jedną linię do wklejenia; raport przeczytasz w `.data/deploy/`.",
  ];
  const gitReferences = references.filter((reference) => /^git[\s_]/i.test(reference));
  if (gitReferences.length > 0) {
    lines.push(
      "Git łączy się z serwerem tylko według listy dozwolonych poleceń: przez `origin`, bez opcji globalnych poza `-C`, bez `-c`, zmiennych `GIT_*` i przekierowań przyklejonych do słów (`2>err.txt` pisz ze spacją przed).",
    );
    const hints = new Set();
    for (const reference of gitReferences) {
      const hint = GIT_HINTS[reference.split(" ")[1]];
      if (hint !== undefined) hints.add(hint);
    }
    lines.push(...hints);
    lines.push(
      "Jeśli to opis commita złożony przez heredoc albo `$(cat <<EOF …)`, hook czyta jego treść jako polecenia: zapisz opis do pliku i użyj `git commit -F <plik>`.",
    );
  }
  lines.push(
    "Tekst w cudzysłowie (opis commita, tytuł PR) nie jest czytany jako polecenie Git; opis ze słowem „ssh” pisz z pliku (`git commit -F`), bo hook czyta cały tekst polecenia.",
  );
  return lines.join("\n");
}

function refuse(message) {
  process.stderr.write(`block-remote-access: ${message}\n`);
  process.exit(2);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (shellText === null) refuse("brak modułu lib/shell-text.mjs, polecenie zablokowane");

  let event;
  try {
    event = JSON.parse(await readStdin());
  } catch {
    refuse("nieczytelne zdarzenie hooka, polecenie zablokowane");
  }

  const command = event?.tool_input?.command;
  if (typeof command !== "string") {
    refuse("zdarzenie bez tekstu polecenia, polecenie zablokowane");
  }

  const references = findRemoteAccess(command);
  if (references.length > 0) {
    process.stderr.write(`${blockMessage(references)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch {
    refuse("błąd hooka, polecenie zablokowane");
  }
}
