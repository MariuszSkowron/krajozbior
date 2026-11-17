#!/usr/bin/env node
// PreToolUse hook (Claude Code): the agent may only switch on GitHub
// auto-merge. It never merges by itself, approves a pull request, changes the
// repository's protection or reads the GitHub token.
//
// Allowed:   gh pr merge <number> --auto --squash [--delete-branch] [-R owner/repo]
//            (flags in any order, `-s` = --squash, `-d` = --delete-branch,
//            combined short flags such as `-sd`, `-R`/`--repo` anywhere)
//            gh pr merge <number> --disable-auto [-R owner/repo]
// Blocked:
//   - every other `gh pr merge` form (plain merge, --admin, --merge, --rebase,
//     no number, extra flags), and any `gh pr merge` / `gh pr review` whose
//     text has quotes, backticks, `$`, globs or brackets (nothing hidden), or
//     that does not start its command segment (`bash -c`, `xargs`, `env`);
//   - `gh pr review --approve` (also `-a` inside combined short flags);
//   - merges and approvals through `gh api` (REST and GraphQL);
//   - changes of the repository's protection through `gh api`: rulesets,
//     branch protection, interaction limits, collaborators, Actions
//     permissions, secrets, variables, webhooks, deploy keys, PATCH/PUT/DELETE
//     of the repository itself, and the matching GraphQL mutations;
//   - `gh repo edit|delete|rename|archive|unarchive`, `gh secret`,
//     `gh variable`, `gh ruleset`, `gh alias`, `gh extension`;
//   - reading the token: `gh auth token`, `gh auth status`,
//     `gh auth git-credential`, `git credential …`, `GH_TOKEN=` /
//     `GITHUB_TOKEN=` and `$GH_TOKEN` / `$env:GH_TOKEN` forms;
//   - other ways to get the token out: `git -c credential.helper=…` and
//     `git config … credential.helper …` (only the two lines of BOOTSTRAP.md,
//     step 9.5, pass), `git-credential-*` programs, `GIT_TRACE_REDACT`,
//     `GIT_CURL_VERBOSE`, `GIT_TRACE_CURL`, PowerShell `GetEnvironmentVariable`
//     (a token name or a name built from pieces), `Get-ChildItem env:`,
//     `printenv` as a command (not as an argument: `grep printenv x` passes),
//     bare `env`, `set`, `export`, `export -p`, `declare -p` / `typeset -p`
//     (all variables or a secret-named one) and `/proc/<pid>/environ`;
//   - `gh api` forms the text cannot prove safe: GraphQL or `/reviews` with
//     `--input`, `query=@file`, `query=$var`; `event=approve` in any case;
//     `…/dismissals`; the full `https://api.github.com/repos/…` URL.
// Read-only `gh api` GET calls to `collaborators/<login>/permission`, `hooks`,
// `keys`, `environments` and `gh secret list` pass.
//
// Rule: docs/agent-workflow.md — GitHub merges only when the ruleset is
// satisfied (required checks, statuses, threads, code-owner approval). An
// agent's approval would count as a human one, so agents never approve; the
// repository's protection is changed only by the owner.
//
// The check reads the command text and is deliberately strict: anything it
// cannot prove to be an allowed form is blocked. Only one kind of text is
// data, not a command (lib/shell-text.mjs, "Message arguments"): the quoted
// message of `git commit -m` and the quoted `--title`/`--body` of `gh pr|issue
// create|edit|comment` may say "PR" and "merge", and only in a plain one-line
// command (no newline, `#`, `$`, backtick, `(`, `{`, `|`, `<`, `>`, heredoc
// or here-string, `\` before a quote, glued or typographic quotes). Not data:
// `gh pr review --body` and `gh pr merge --body`, a heredoc body (every line
// is checked like a command) and anything in a command that is not plain;
// write such a message from a file (`git commit -F <file>`, `--body-file`). The
// hook is a fence against mistakes, not the security boundary: that is the
// ruleset and CODEOWNERS on GitHub.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event
// exits 1 (a hook bug, reported but not blocking).
import { pathToFileURL } from "node:url";

import {
  baseName,
  detectionVariants,
  maskShellData,
  splitSegments,
  words,
} from "./lib/shell-text.mjs";

// The only characters a `gh pr merge` / `gh pr review` segment may contain.
const PLAIN_SEGMENT = /^[A-Za-z0-9_./\\:=\s-]+$/;
const REPO_SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GH_EXECUTABLES = new Set(["gh", "gh.exe"]);

const AUTO_MERGE_FLAGS = new Set(["--auto", "--squash"]);
const OPTIONAL_FLAGS = new Set(["--delete-branch"]);
const MERGE_SHORT_FLAGS = { s: "--squash", d: "--delete-branch" };

// Text that names a merge or a review, however it is spelled around.
const MENTIONS_MERGE = /\bpr\b[\s\S]*\bmerge\b/i;
const MENTIONS_REVIEW = /\bpr\b[\s\S]*\breview\b/i;
const MENTIONS_GH = /\bgh\b/i;

// `gh api` paths and GraphQL operations the agent never touches.
const REST_MERGE = /\bpulls\/[^/\s]+\/merge\b/i;
const REST_BRANCH_MERGE = /\brepos\/\S+\/merges\b/i;
const GRAPHQL_MERGE =
  /\b(?:mergePullRequest|enablePullRequestAutoMerge|mergeBranch|addPullRequestReview|submitPullRequestReview)\b/i;
const REST_REVIEW = /\bpulls\/[^/\s]+\/reviews\b/i;
const REST_DISMISSAL = /\breviews\/[^/\s]+\/dismissals\b/i;
const APPROVE_EVENT = /\bapprove\b/i;
// Always blocked, also for a plain GET.
const REST_PROTECTION =
  /\b(?:rulesets?|protection|interaction-limits|invitations|actions\/permissions|actions\/secrets|actions\/variables|autolinks)\b/i;
// Blocked unless the call is a plain read (GET, no body): webhooks, deploy keys,
// environments and the permission of one collaborator.
const REST_READABLE = /\b(?:environments|hooks|keys)\b/i;
const COLLABORATOR_PERMISSION = /\bcollaborators\/[^\s/]+\/permission(?=[\s?#]|$)/gi;
const COLLABORATORS = /\bcollaborators\b/i;
const GRAPHQL_PROTECTION =
  /\b(?:\w*RepositoryRuleset|\w*BranchProtectionRule|updateRepository|deleteRepository|archiveRepository|unarchiveRepository|transferRepository|\w*Collaborator\w*)\b/;
const METHOD_WRITE = /(?:^|\s)(?:-X\s*|--method(?:\s+|=))(?:PATCH|PUT|DELETE)\b/i;
const METHOD_NOT_GET = /(?:^|\s)(?:-X\s*|--method(?:\s+|=))(?!GET\b)\w+/i;
// `-f`, `-F`, `--field`, `--raw-field` and `--input` make `gh api` send a body.
const API_BODY = /(?:^|\s)(?:-[fF]\S*|--(?:raw-)?field\S*|--input\S*)/;
const API_INPUT_FILE = /(?:^|\s)--input\S*/;
// A GraphQL query read from a file or a variable: its text cannot be checked.
const GRAPHQL_HIDDEN_QUERY = /\bquery=\s*[@$]/i;
const REPO_ITSELF =
  /(?:^|\s)(?:https?:\/\/api\.github\.com)?\/?repos\/[^\s/]+\/[^\s/]+\/?(?=[\s?#]|$)/i;

const BLOCKED_GH_COMMANDS = new Set(["secret", "variable", "ruleset", "alias", "extension"]);
const BLOCKED_REPO_COMMANDS = new Set(["edit", "delete", "rename", "archive", "unarchive"]);
const BLOCKED_AUTH_COMMANDS = new Set(["token", "status", "git-credential"]);

// The token in the environment: setting it for a command or reading it.
const TOKEN_ENV = String.raw`(?:GH|GITHUB)_(?:ENTERPRISE_)?TOKEN`;
const TOKEN_IN_ENV = new RegExp(
  String.raw`\b${TOKEN_ENV}\s*=|\$\{?${TOKEN_ENV}\b|env:${TOKEN_ENV}\b|printenv\s+${TOKEN_ENV}\b`,
  "i",
);
// `git credential fill` and friends print the stored password; the git
// options before the subcommand (`-C dir`, `-c key=value`) do not hide it.
// `git config credential.<url>.helper` is a different command and allowed.
const GIT_CREDENTIAL =
  /(?:^|[\s\\/])git(?:\.exe)?(?:\s+(?:-C\s+\S+|-c\s+\S+|--\S+))*\s+credential(?:-[\w-]+)?(?=\s|$)/i;
// A credential helper runs a program with the stored password on its stdin;
// pointing it at a script (`git -c credential.helper=...`, `git config
// credential.helper ...`) leaks the token. The only helper settings allowed are
// the two lines of BOOTSTRAP.md (step 9.5; scripts/bot-token.ps1 sets them), compared as whole segments.
// No leading `\b`: `git -ccredential.helper=x` is valid.
const CREDENTIAL_HELPER_KEY = /credential(?:\.[^\s=]+)?\.helper\b/i;
const ALLOWED_HELPER_SEGMENTS = [
  /^git(?:\.exe)?\s+config\s+credential\.https:\/\/github\.com\.helper\s+(?:""|'')$/,
  /^git(?:\.exe)?\s+config\s+--add\s+credential\.https:\/\/github\.com\.helper\s+["']!gh auth git-credential["']$/,
];
// Programs such as `git-credential-manager` or `git-credential-store`.
const CREDENTIAL_PROGRAM = /(?:^|[\s\\/])git-credential-[\w.-]+/i;
// Git tracing that prints the Authorization header.
const GIT_TRACE_LEAK = /\bGIT_(?:TRACE_REDACT|CURL_VERBOSE|TRACE_CURL)\b/i;
// PowerShell: the whole environment, or a variable whose name is not a plain
// literal (`'GH_'+'TOKEN'`) or is a token.
const ENV_LISTING =
  /\b(?:get-childitem|gci|ls|dir)\s+(?:-(?:literal)?path\s+)?["'`]?\$?\{?env:|\bget-item\s+(?:-(?:literal)?path\s+)?["'`]?env:\s*\*/i;
const ENV_DYNAMIC = /\$\{?env:\s*[($]/i;
const GET_ENV_CALL = /GetEnvironmentVariables?\s*\(/i;
const PLAIN_GET_ENV =
  /GetEnvironmentVariable\(\s*(["'])([A-Za-z0-9_]+)\1\s*(?:,\s*[\w."']+\s*)?\)/gi;
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE/i;
const ENV_LISTERS = new Set(["printenv", "printenv.exe"]);
// The environment of a process as a file (Linux, WSL, Git Bash): any pid.
const PROC_ENVIRON = /\/proc\/[^\s/]*\/environ\b/i;
// Words after which the next word is again a program name.
const COMMAND_WRAPPERS = new Set([
  "command",
  "builtin",
  "exec",
  "nohup",
  "sudo",
  "time",
  "nice",
  "timeout",
  "xargs",
  "env",
  "watch",
  "call",
  "iex",
  "invoke-expression",
  "start-process",
  ".",
  "&",
]);
// Shells and the options that take a command line (`bash -c`, `pwsh -Command`, `cmd /c`).
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "pwsh", "powershell", "cmd", "wsl"]);
const COMMAND_OPTION = /^(?:-c|-command|--command|\/c|\/k|-e|--exec)$/i;
// Command substitution or a subshell opens a new command position.
const SUBSTITUTION_START = /^(?:\$\(|<\(|\(|`|\{)+/;

export const ALLOWED_FORM = "gh pr merge <numer> --auto --squash [--delete-branch]";

/** Expands combined short flags (`-sd` -> --squash --delete-branch); null if unknown. */
function expandMergeFlags(args) {
  const expanded = [];

  for (const arg of args) {
    if (/^-[A-Za-z]+$/.test(arg)) {
      for (const letter of arg.slice(1)) {
        const flag = MERGE_SHORT_FLAGS[letter];
        if (flag === undefined) return null;
        expanded.push(flag);
      }
    } else {
      expanded.push(arg);
    }
  }
  return expanded;
}

/** True when the arguments of `gh pr merge` are exactly an allowed form. */
export function isAllowedMergeArgs(rawArgs) {
  const args = expandMergeFlags(rawArgs);
  if (args === null) return false;

  const positional = args.filter((arg) => !arg.startsWith("-"));
  const flags = args.filter((arg) => arg.startsWith("-"));
  if (positional.length !== 1 || !/^\d+$/.test(positional[0])) return false;
  if (new Set(flags).size !== flags.length) return false;

  if (flags.length === 1 && flags[0] === "--disable-auto") return true;

  for (const required of AUTO_MERGE_FLAGS) {
    if (!flags.includes(required)) return false;
  }
  return flags.every((flag) => AUTO_MERGE_FLAGS.has(flag) || OPTIONAL_FLAGS.has(flag));
}

/**
 * The words of one gh invocation without `-R` / `--repo` (anywhere), or null
 * when a repository value is not a plain `owner/repo`.
 */
function withoutRepoFlags(args) {
  const out = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    let value = null;

    if (arg === "-R" || arg === "--repo") {
      i += 1;
      value = args[i] ?? "";
    } else if (arg.startsWith("--repo=")) value = arg.slice("--repo=".length);
    else if (/^-R./.test(arg)) value = arg.slice(2);

    if (value === null) out.push(arg);
    else if (!REPO_SLUG.test(value)) return null;
  }
  return out;
}

// `--approve`, `--approve=true`, `-a`, `-ca`, `-a=true` (any letter case of the
// value does not matter: the flag itself is the approval).
const approves = (arg) =>
  arg === "--approve" ||
  arg.startsWith("--approve=") ||
  (/^-[A-Za-z]+(?:=.*)?$/.test(arg) && arg.split("=")[0].includes("a"));

/** Reasons to block one gh invocation (`args` are the words after `gh`). */
function checkGhInvocation(args, trusted) {
  const rest = withoutRepoFlags(args);
  const shown = ["gh", ...args].join(" ");

  if (rest === null) return [`niejasna wartość -R/--repo: "${shown}"`];

  const reasons = [];
  const [command, sub] = rest;
  const apiText = args.join(" ");

  if (command === "pr" && sub === "merge") {
    if (!trusted) {
      reasons.push(`gh pr merge z cudzysłowem, zmienną, globem lub nie na początku: "${shown}"`);
    } else if (!isAllowedMergeArgs(rest.slice(2))) {
      reasons.push(`niedozwolona forma scalania: "${shown}"`);
    }
  }
  if (command === "pr" && sub === "review" && rest.slice(2).some(approves)) {
    reasons.push("agent nie zatwierdza PR (gh pr review --approve)");
  }
  if (command === "repo" && BLOCKED_REPO_COMMANDS.has(sub)) {
    reasons.push(`zmiana ustawień repozytorium (gh repo ${sub})`);
  }
  // `gh secret list` prints names only; every other gh secret form stays blocked.
  const readsSecretNames = command === "secret" && sub === "list";
  if (BLOCKED_GH_COMMANDS.has(command) && !readsSecretNames) {
    reasons.push(`gh ${command} (sekrety, reguły albo polecenie, które może ukryć inne działanie)`);
  }
  if (command === "auth" && BLOCKED_AUTH_COMMANDS.has(sub)) {
    reasons.push(`odczyt tokenu lub konta (gh auth ${sub})`);
  }
  if (command === "api") {
    if (REST_MERGE.test(apiText) || REST_BRANCH_MERGE.test(apiText)) {
      reasons.push("scalanie przez API (gh api .../merge lub .../merges)");
    }
    if (GRAPHQL_MERGE.test(apiText)) reasons.push("scalanie lub review przez GraphQL");
    if (/\bgraphql\b/i.test(apiText)) {
      if (GRAPHQL_HIDDEN_QUERY.test(apiText) || API_INPUT_FILE.test(apiText)) {
        reasons.push(
          "zapytanie GraphQL z pliku lub zmiennej (--input, query=@plik): jego treści nie da się sprawdzić, podaj je w poleceniu",
        );
      }
    }
    if (REST_REVIEW.test(apiText)) {
      if (APPROVE_EVENT.test(apiText)) reasons.push("zatwierdzenie PR przez API (event=APPROVE)");
      if (API_INPUT_FILE.test(apiText)) {
        reasons.push("review przez API z plikiem (--input): jego treści nie da się sprawdzić");
      }
    }
    if (REST_DISMISSAL.test(apiText)) reasons.push("odrzucenie zatwierdzenia review przez API");
    const writesOrSendsBody = METHOD_NOT_GET.test(apiText) || API_BODY.test(apiText);
    const withoutPermissionReads = apiText.replace(COLLABORATOR_PERMISSION, " ");
    if (
      REST_PROTECTION.test(apiText) ||
      GRAPHQL_PROTECTION.test(apiText) ||
      COLLABORATORS.test(withoutPermissionReads) ||
      ((REST_READABLE.test(apiText) || withoutPermissionReads !== apiText) && writesOrSendsBody)
    ) {
      reasons.push("zmiana ochrony lub dostępu do repozytorium przez API");
    }
    if (METHOD_WRITE.test(apiText) && REPO_ITSELF.test(apiText)) {
      reasons.push("zmiana ustawień repozytorium przez API (PATCH/PUT/DELETE repos/<o>/<r>)");
    }
  }
  return reasons;
}

/**
 * The words of a segment that stand where a program name stands: the first
 * word, the word after a wrapper (`command`, `xargs`, `sudo`, `env X=1`, ...),
 * after `-c` / `-Command` / `/c`, and the start of `$(...)`, `(...)` or a
 * backtick substitution. `grep printenv notes.md` has one: `grep`.
 */
export function commandWords(text) {
  const result = [];
  let expectCommand = true;
  let afterWrapper = false;
  let program = "";

  for (const raw of words(text)) {
    const opensCommand = SUBSTITUTION_START.test(raw);
    const word = raw.replace(SUBSTITUTION_START, "").replace(/[)}`]+$/, "");
    if (word === "") {
      expectCommand = true;
      continue;
    }
    if (opensCommand) {
      expectCommand = true;
      afterWrapper = false;
    }
    const name = baseName(word).replace(/\.exe$/, "");

    if (expectCommand) {
      if (/^[A-Za-z_]\w*=/.test(word) || (afterWrapper && word.startsWith("-"))) continue;
      result.push(word);
      program = name;
      afterWrapper = COMMAND_WRAPPERS.has(name);
      expectCommand = afterWrapper;
    } else if (SHELLS.has(program) && COMMAND_OPTION.test(word)) {
      expectCommand = true;
      afterWrapper = false;
    }
  }
  return result;
}

/**
 * True when a segment lists the environment: `env` / `env -0`, `set`,
 * `export` / `export -p`, `declare` / `typeset` with only options (`-p`,
 * `-x`), or `declare -p` naming a secret-looking variable.
 */
function listsEnvironment(variant) {
  // Redirects write the listing somewhere; they do not make it a command.
  const bare = variant.replace(/\d*>{1,2}\s*\S+/g, " ").replace(/<\s*\S+/g, " ");
  const segmentWords = words(bare);
  const program = baseName(segmentWords[0] ?? "").replace(/\.exe$/, "");
  const args = segmentWords.slice(1);
  const onlyOptions = args.every((arg) => arg.startsWith("-"));

  if (program === "env") return onlyOptions;
  if (program === "set") return args.length === 0;
  if (program === "export") return args.every((arg) => arg === "-p");
  if (program === "declare" || program === "typeset") {
    const printsValues = args.some((arg) => /^-[A-Za-z]*p/.test(arg));
    return onlyOptions || (printsValues && args.some((arg) => SECRET_NAME.test(arg)));
  }
  return false;
}

/** Reasons to read the token through the environment, git tracing or a credential helper. */
function checkTokenExfiltration(rawSegment, variant) {
  const reasons = [];

  if (
    CREDENTIAL_HELPER_KEY.test(variant) &&
    !ALLOWED_HELPER_SEGMENTS.some((allowed) => allowed.test(rawSegment))
  ) {
    reasons.push(
      "credential.helper wskazujący własny program (wyciek tokenu); dozwolone tylko dwie linie z BOOTSTRAP.md",
    );
  }
  if (CREDENTIAL_PROGRAM.test(variant))
    reasons.push("program git-credential-* (odczyt poświadczeń)");
  if (GIT_TRACE_LEAK.test(variant)) {
    reasons.push("ślad git (GIT_TRACE_REDACT, GIT_CURL_VERBOSE, GIT_TRACE_CURL) wypisuje token");
  }
  if (ENV_LISTING.test(variant) || ENV_DYNAMIC.test(variant)) {
    reasons.push("lista zmiennych środowiskowych (env:) albo nazwa zmiennej budowana z kawałków");
  }
  if (GET_ENV_CALL.test(variant)) {
    const plain = [...rawSegment.matchAll(PLAIN_GET_ENV)];
    const allPlain =
      plain.length > 0 &&
      (rawSegment.match(/GetEnvironmentVariables?\s*\(/gi) ?? []).length === plain.length;
    if (!allPlain || plain.some((match) => SECRET_NAME.test(match[2]))) {
      reasons.push("GetEnvironmentVariable z nazwą tokenu, zbudowaną z kawałków lub cała lista");
    }
  }
  if (commandWords(variant).some((word) => ENV_LISTERS.has(baseName(word)))) {
    reasons.push("printenv (lista zmiennych środowiskowych)");
  }
  if (PROC_ENVIRON.test(variant)) {
    reasons.push("odczyt środowiska procesu (/proc/<pid>/environ)");
  }
  if (listsEnvironment(variant)) {
    reasons.push("polecenie wypisujące środowisko (env, set, export, declare -p)");
  }
  return reasons;
}

/** Reasons to block one command segment. */
function checkSegment(rawSegment) {
  const reasons = [];
  const rawWords = words(rawSegment);
  // A segment typed as plain words that starts with gh is parsed exactly;
  // anything else is only searched for dangerous text.
  const trusted = GH_EXECUTABLES.has(baseName(rawWords[0] ?? "")) && PLAIN_SEGMENT.test(rawSegment);

  for (const variant of detectionVariants(rawSegment)) {
    const variantWords = words(variant);

    variantWords.forEach((word, index) => {
      if (!GH_EXECUTABLES.has(baseName(word))) return;
      const exact = trusted && index === 0 && variant === rawSegment;
      reasons.push(...checkGhInvocation(variantWords.slice(index + 1), exact));
    });

    if (!trusted && MENTIONS_MERGE.test(variant)) {
      reasons.push(`polecenie wspomina „pr merge” w formie, której nie da się sprawdzić`);
    }
    // Only with `gh` in the text: "fix after PR review" in a commit message is fine.
    if (!trusted && MENTIONS_GH.test(variant) && MENTIONS_REVIEW.test(variant)) {
      reasons.push(
        "gh pr review z cudzysłowem, zmienną lub nie na początku (treść podaj w --body-file)",
      );
    }
    if (TOKEN_IN_ENV.test(variant)) reasons.push("token GitHub w zmiennej środowiskowej");
    if (GIT_CREDENTIAL.test(variant)) reasons.push("odczyt poświadczeń (git credential)");
    reasons.push(...checkTokenExfiltration(rawSegment, variant));
  }
  return reasons;
}

/** Reasons to block the command (an empty list lets it through). */
export function findPrGateViolations(command) {
  if (typeof command !== "string") return [];

  return [...new Set(splitSegments(maskShellData(command)).flatMap(checkSegment))];
}

export function blockMessage(reasons) {
  return [
    `Zablokowano polecenie: ${reasons.join("; ")}.`,
    `Agentowi wolno tylko włączyć auto-merge: ${ALLOWED_FORM} (albo wyłączyć je: gh pr merge <numer> --disable-auto).`,
    "GitHub scali PR sam, gdy spełnione są reguły gałęzi main (checki, statusy agent-review i security-review, rozwiązane wątki, zatwierdzenie właściciela dla ścieżek z CODEOWNERS).",
    "Ustawienia repozytorium, reguły gałęzi, sekrety i token zmienia wyłącznie właściciel.",
    "Zasada: docs/agent-workflow.md, etap „Scalenie”. Agent nigdy nie zatwierdza PR i nie używa --admin.",
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
    process.stderr.write("guard-pr-merge: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const reasons = findPrGateViolations(event?.tool_input?.command);
  if (reasons.length > 0) {
    process.stderr.write(`${blockMessage(reasons)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
