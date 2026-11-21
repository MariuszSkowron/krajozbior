#!/usr/bin/env node
// PreToolUse hook (Claude Code): blocks shell commands that reach a remote
// server or SSH keys: ssh, scp, sftp, ssh-add, ssh-agent, ssh-copy-id,
// ssh-keygen, ssh-keyscan, PuTTY tools (plink, pscp, psftp, putty), PowerShell
// remoting over SSH (-HostName, -SSHTransport), any `.ssh` folder, the folder
// with deployment secrets (`krajozbior-deploy`) and the local showcase data
// (`.data/showcase`). Deployment runs only in the owner's own PowerShell window
// (E11 spec, D-E11-4; security-notes.md).
// It reads command text only: a script that connects by itself is not caught;
// the real boundary is the deployment passphrase the agent does not know.
//
// Contract: reads the hook event as JSON on stdin. Exit 2 with a message on
// stderr blocks the tool call; exit 0 lets it through. A malformed event exits
// 1 (a hook bug, reported but not blocking).
import { pathToFileURL } from "node:url";

import { detectionVariants, joinContinuations } from "./lib/shell-text.mjs";

const REMOTE_TOOL =
  /(?<![A-Za-z0-9_.-])(?:ssh-copy-id|ssh-keyscan|ssh-keygen|ssh-agent|ssh-add|ssh|scp|sftp|plink|pscp|psftp|putty)(?:\.exe)?(?![A-Za-z0-9_.-])/gi;
const SSH_DIR = /(?<![A-Za-z0-9_.-])\.ssh(?=[\\/]|$|[\s"'`;|&<>)])/gi;
const DEPLOY_DIR = /krajozbior-deploy/gi;
const PS_REMOTING = /-(?:HostName|SSHTransport)\b/gi;
const SHOWCASE_DIR = /\.data[\\/]showcase/gi;
const PATTERNS = [REMOTE_TOOL, SSH_DIR, DEPLOY_DIR, PS_REMOTING, SHOWCASE_DIR];

/** The parts of the command that reach a server or SSH keys (empty = safe). */
export function findRemoteAccess(command) {
  if (typeof command !== "string") return [];

  const found = [];
  for (const variant of detectionVariants(joinContinuations(command))) {
    for (const pattern of PATTERNS) {
      for (const match of variant.matchAll(pattern)) found.push(match[0]);
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
    process.stderr.write("block-remote-access: nieczytelne zdarzenie hooka\n");
    process.exit(1);
  }

  const references = findRemoteAccess(event?.tool_input?.command);
  if (references.length > 0) {
    process.stderr.write(`${blockMessage(references)}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
