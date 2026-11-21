#!/usr/bin/env node
// PreToolUse hook (Claude Code): blocks shell commands that reach a remote
// server or SSH keys when the command text says so:
// - SSH clients and relatives (ssh, scp, sftp, ssh-add, ssh-agent, ssh-copy-id,
//   ssh-keygen, ssh-keyscan, sshpass, sshfs, autossh, mosh), rsync, rclone and
//   PuTTY tools (plink, pscp, psftp, putty);
// - git used as an SSH transport: a remote in the `user@host:path` or
//   `host.domain:path` form, `ssh://`, `core.sshCommand`, `GIT_SSH*`,
//   `--upload-pack`/`--receive-pack` (also as config keys), `-u` of
//   `git clone`/`git ls-remote`, `--exec` of the network subcommands, `ext::`;
// - PowerShell remoting: the session cmdlets as a whole (Enter-PSSession,
//   New-PSSession, Connect-PSSession, Receive-PSSession, Invoke-Command and
//   their aliases), `-HostN…`/`-SSH…` parameters, `HostName =` in a splatting
//   table, and `powershell -EncodedCommand` (in any abbreviation);
// - any `.ssh` folder, the folder with deployment secrets (`krajozbior-deploy`,
//   also as a wildcard) and the local showcase data (`.data/showcase`,
//   `showcase/outbox`, a wildcard in `.data` or a recursive read of `.data`).
// Deployment runs only in the owner's own PowerShell window (E11 spec,
// D-E11-4; security-notes.md).
//
// Limits: the hook reads the command text only. It stops a command typed
// plainly (also with quotes, backslashes, backticks and `^` inside a name);
// it does not stop a name assembled at run time (variables, `iex`, base64,
// wildcards such as `ss?`), a script file run with `-File`, `node -e` with
// child_process, or a remote already configured in git. It is a guard against
// accidental use, not a security boundary: that is the deployment passphrase
// the agent does not know. The test lists these limits.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event, an
// event without a command text or an internal error also exits 2: a security
// hook blocks when it cannot read the command (Claude Code never sends such an
// event, so this costs no false blocks).
import { pathToFileURL } from "node:url";

import { detectionVariants, joinContinuations } from "./lib/shell-text.mjs";

const REMOTE_TOOL =
  /(?<![A-Za-z0-9_.-])(?:ssh-copy-id|ssh-keyscan|ssh-keygen|ssh-agent|ssh-add|sshpass|sshfs|autossh|ssh|scp|sftp|mosh|rsync|rclone|plink|pscp|psftp|putty)(?:\.exe)?(?![A-Za-z0-9_-]|\.[A-Za-z0-9_-])/gi;
const SSH_DIR = /(?<![A-Za-z0-9_.-])\.ssh(?![A-Za-z0-9])/gi;
const DEPLOY_DIR = /krajozbior(?:-dep|[\w-]{0,6}[*?[{]|[\\/]+[*?[{])/gi;
const SHOWCASE_DIR = /\.data[\\/.]*[\\/]+showcase|showcase[\\/]+outbox/gi;
const DATA_WILDCARD = /(?<![\w.-])\.data[\\/]*[*?[{]/gi;
// Git settings and options that start SSH or run a command for a remote.
const GIT_TRANSPORT =
  /git_ssh|sshcommand|ssh\.variant|--(?:upload|receive)-pack|\b(?:uploadpack|receivepack)\b|(?<![\w-])ext::/gi;
const GIT_UPLOAD_SHORT =
  /(?<![\w-])git(?:\.exe)?(?![\w-])[^;&|\r\n]*?\s(?:clone|ls-remote)(?![\w-])[^;&|\r\n]*?\s-u(?![\w-])/gi;
const GIT_EXEC =
  /(?<![\w-])git(?:\.exe)?(?![\w-])[^;&|\r\n]*?\s(?:clone|ls-remote|fetch|pull|push|archive)(?![\w-])[^;&|\r\n]*?\s--exec(?![\w-])/gi;
// `user@host:path` (scp-like remote of git, rsync, scp); not a port
// (`user@localhost:55442/db`) and not a package or image reference
// (`pkg@npm:x`, `image@sha256:…`).
const SCP_LIKE_REMOTE =
  /(?<![\w.+%:/-])[\w.+%-]+@(?!(?:npm|sha256|sha512|file|link|workspace|patch):)[\w.-]+:(?!\d+(?:[\\/\s?#]|$))/gi;
// `host.domain:path` without a user, checked only in a git command: the last
// label starts with a letter, so `HEAD:file`, `main:main`, `v1.2.3:x` pass.
const GIT_PROGRAM = /(?<![\w-])git(?:\.exe)?(?![\w-])/i;
const HOST_ONLY_REMOTE =
  /(?<![\w.:/@\\%+-])(?:[A-Za-z][\w-]*(?:\.[\w-]+)*\.[A-Za-z][\w-]*|\d{1,3}(?:\.\d{1,3}){3}):(?!\d+(?:[\\/\s?#]|$))(?!\/\/)/gi;
// PowerShell remoting. The cmdlets are blocked as a whole, so a parameter
// abbreviation (`-Ho`, `-HostN`) or a splatting table does not matter for them;
// `-Ho`/`-Host` alone are not blocked elsewhere (`grep -ho` is common).
const PS_REMOTING_CMDLET =
  /(?<![\w-])(?:Enter-PSSession|New-PSSession|Connect-PSSession|Receive-PSSession|Invoke-Command|etsn|nsn|cnsn|rcsn|icm)(?![\w-])/gi;
const PS_REMOTING_PARAM = /(?<![\w-])-(?:HostN\w*|SSH\w*)/gi;
const PS_REMOTING_SPLAT =
  /(?:@\{(?:[^}]*?[\s;])?|[.[])(?:HostName|SSHTransport|SSHConnection)\]?\s*=/gi;
const PS_ENCODED =
  /(?<![\w-])(?:powershell|pwsh)(?:\.exe)?(?![\w-])[^;&|\r\n]*?\s[-/]e(?:c|n\w*)?(?![\w-])/gi;

const PATTERNS = [
  REMOTE_TOOL,
  SSH_DIR,
  DEPLOY_DIR,
  SHOWCASE_DIR,
  DATA_WILDCARD,
  GIT_TRANSPORT,
  GIT_UPLOAD_SHORT,
  GIT_EXEC,
  SCP_LIKE_REMOTE,
  PS_REMOTING_CMDLET,
  PS_REMOTING_PARAM,
  PS_REMOTING_SPLAT,
  PS_ENCODED,
];

// A recursive read of the whole `.data` folder reaches the showcase data.
const BARE_DATA_DIR = /(?<![\w.-])\.data[\\/]*(?=$|[\s;|&<>),])/i;
const RECURSION =
  /(?<![\w-])(?:-[a-z]{0,3}r[a-z]{0,3}|--recursive|-rec\w*|-depth)(?![\w-])|(?<![\w-])(?:rg|tree|find|robocopy|xcopy|tar|zip|7z|compress-archive|du)(?:\.exe)?(?![\w-])/i;

/**
 * Detection variants of the shared module plus the same texts without `^`,
 * which `cmd` removes like a quote (`s^sh` runs `ssh`).
 */
function variantsOf(command) {
  const variants = detectionVariants(joinContinuations(command));
  return [...new Set([...variants, ...variants.map((variant) => variant.replace(/\^/g, ""))])];
}

/** The parts of the command that reach a server or SSH keys (empty = safe). */
export function findRemoteAccess(command) {
  if (typeof command !== "string") return [];

  const found = [];
  for (const variant of variantsOf(command)) {
    for (const pattern of PATTERNS) {
      for (const match of variant.matchAll(pattern)) found.push(match[0]);
    }
    if (GIT_PROGRAM.test(variant)) {
      for (const match of variant.matchAll(HOST_ONLY_REMOTE)) found.push(match[0]);
    }
    if (BARE_DATA_DIR.test(variant) && RECURSION.test(variant)) {
      found.push(".data (rekurencyjnie)");
    }
  }
  return [...new Set(found)];
}

export function blockMessage(references) {
  return [
    `Zablokowano polecenie powłoki: łączy się z serwerem albo sięga po klucze SSH lub sekrety wdrożeniowe (${references.join(", ")}).`,
    "Zasada: specyfikacja E11 (D-E11-4) i security-notes.md — wdrożenie, wgrywanie kolekcji i diagnozę uruchamia właściciel w swoim oknie PowerShell (`wdroz.ps1`).",
    "Przygotuj commit i podaj właścicielowi jedną linię do wklejenia; raport przeczytasz w `.data/deploy/`.",
    "Opis commita ze słowem „ssh” pisz z pliku (`git commit -F`), bo hook czyta cały tekst polecenia.",
  ].join("\n");
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
