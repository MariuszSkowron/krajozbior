#!/usr/bin/env node
// Mints a GitHub App installation token (valid for 1 hour) and logs `gh` in
// as the app, so agents work on GitHub only as `<app-slug>[bot]`.
//
// Run through scripts/bot-token.ps1 (it also sets the git author and the git
// credential helper). Flow:
//   1. read the non-secret app settings from .github/bot.json,
//   2. read the private key from the single *.pem file in
//      ~/.config/<app-slug>/ (outside both repositories; the agent's Read
//      tool and shell hooks are denied that folder),
//   3. sign a short JWT (RS256, 9 minutes) with node:crypto,
//   4. check the installation: only selected repositories, no permission
//      beyond the pipeline's set (no Administration, no account permissions),
//   5. POST /app/installations/{id}/access_tokens narrowed to the two project
//      repositories and the pipeline's permissions,
//   6. `gh auth login --with-token` with the token on stdin.
// The token and the key are never printed, logged or passed as arguments.
//
// No npm dependency: node:crypto signs the JWT, global fetch calls the API.
// Test mode (`--api <url> --key-file <file> --dry-run`) talks to a fake API
// with a throwaway key and skips the gh login; a non-default API refuses the
// real key, so the real key never signs anything sent to another server.
import { createPrivateKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_API = "https://api.github.com";
export const API_VERSION = "2022-11-28";

/**
 * Repository permissions of the pipeline (docs: BOOTSTRAP.md, step 9).
 * contents: push branches and docs commits; pull_requests: draft PRs,
 * comments, ready, auto-merge; statuses: agent-review / security-review;
 * issues: tasks in the docs repository; checks + actions: read CI results;
 * metadata: required by GitHub for every app.
 */
export const PIPELINE_PERMISSIONS = Object.freeze({
  contents: "write",
  pull_requests: "write",
  statuses: "write",
  issues: "write",
  checks: "read",
  actions: "read",
  metadata: "read",
});

// Granted only after a recorded owner decision (BOOTSTRAP.md, step 9): the
// app then may change files in .github/workflows/. Never requested here.
const TOLERATED_EXTRA = new Set(["workflows"]);
const LEVEL = { read: 1, write: 2, admin: 3 };

const SLUG = /^[a-z0-9][a-z0-9-]{0,33}$/;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}$/;

export class BotTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = "BotTokenError";
  }
}

const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

/** Validates .github/bot.json; every value in it is public (no secret). */
export function parseBotConfig(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BotTokenError(".github/bot.json nie jest poprawnym JSON.");
  }
  const missing = [];
  if (typeof raw?.owner !== "string" || !LOGIN.test(raw.owner)) missing.push("owner");
  if (typeof raw?.appSlug !== "string" || !SLUG.test(raw.appSlug)) missing.push("appSlug");
  if (!positiveInteger(raw?.appId)) missing.push("appId");
  if (!positiveInteger(raw?.installationId)) missing.push("installationId");
  if (
    !Array.isArray(raw?.repositories) ||
    raw.repositories.length !== 2 ||
    !raw.repositories.every((name) => typeof name === "string" && REPO_NAME.test(name)) ||
    raw.repositories[0] === raw.repositories[1]
  ) {
    missing.push("repositories");
  }
  if (missing.length > 0) {
    throw new BotTokenError(
      `Uzupelnij .github/bot.json (BOOTSTRAP.md, krok 9): brak lub zla wartosc ${missing.join(", ")}.`,
    );
  }
  return {
    owner: raw.owner,
    appSlug: raw.appSlug,
    appId: raw.appId,
    installationId: raw.installationId,
    botUserId: positiveInteger(raw.botUserId) ? raw.botUserId : null,
    repositories: [...raw.repositories],
  };
}

/** The bot's git identity: `<app-slug>[bot]` and its noreply address. */
export function botGitIdentity({ appSlug, botUserId }) {
  const name = `${appSlug}[bot]`;
  return {
    name,
    email: botUserId === null ? null : `${botUserId}+${name}@users.noreply.github.com`,
  };
}

/**
 * JWT claims for authenticating as the app. `iat` is 60 s in the past (clock
 * drift), `exp` 9 minutes ahead (GitHub allows at most 10).
 */
export function buildJwtClaims({ appId, nowSeconds }) {
  if (!positiveInteger(appId)) throw new BotTokenError("appId musi byc dodatnia liczba calkowita.");
  if (!Number.isSafeInteger(nowSeconds)) throw new BotTokenError("nowSeconds musi byc liczba.");
  return { iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId };
}

export function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/** RS256 JWT signed with the app's private key (PEM text or KeyObject). */
export function signAppJwt({ appId, privateKey, nowSeconds = Math.floor(Date.now() / 1000) }) {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = buildJwtClaims({ appId, nowSeconds });
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  let key;
  try {
    key = typeof privateKey === "string" ? createPrivateKey(privateKey) : privateKey;
  } catch {
    throw new BotTokenError("Plik klucza nie jest poprawnym kluczem prywatnym PEM.");
  }
  if (key.asymmetricKeyType !== "rsa") {
    throw new BotTokenError("Klucz aplikacji GitHub musi byc kluczem RSA.");
  }
  const signature = sign("sha256", Buffer.from(signingInput), key);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** Body of POST /app/installations/{id}/access_tokens. */
export function buildTokenRequest(config) {
  return { repositories: [...config.repositories], permissions: { ...PIPELINE_PERMISSIONS } };
}

/**
 * Problems with a permission set returned by GitHub (installation or token):
 * any permission outside the pipeline's set (Administration, account or
 * organization permissions...) or a higher level than the pipeline needs.
 * `workflows` is reported separately as tolerated, never as fine.
 */
export function checkPermissions(permissions, { tolerateWorkflows = false } = {}) {
  const problems = [];
  for (const [name, level] of Object.entries(permissions ?? {})) {
    const wanted = PIPELINE_PERMISSIONS[name];
    if (wanted === undefined) {
      if (!(tolerateWorkflows && TOLERATED_EXTRA.has(name))) problems.push(`${name}: ${level}`);
    } else if ((LEVEL[level] ?? 99) > LEVEL[wanted]) {
      problems.push(`${name}: ${level} (potrzebne ${wanted})`);
    }
  }
  return problems;
}

/** The default key folder: %USERPROFILE%\.config\<app-slug>\ (outside the repositories). */
export function defaultKeyDir(appSlug, home = homedir()) {
  return join(home, ".config", appSlug);
}

/** The single *.pem file of the key folder (two files = a rotation not finished). */
export function findKeyFile(directory) {
  if (!existsSync(directory)) {
    throw new BotTokenError(
      `Brak folderu klucza aplikacji (${directory}). Przenies pobrany plik .pem wedlug BOOTSTRAP.md, krok 9.`,
    );
  }
  const pems = readdirSync(directory).filter((name) => name.toLowerCase().endsWith(".pem"));
  if (pems.length === 0) {
    throw new BotTokenError(`W folderze ${directory} nie ma pliku .pem (BOOTSTRAP.md, krok 9).`);
  }
  if (pems.length > 1) {
    throw new BotTokenError(
      `W folderze ${directory} jest ${pems.length} plikow .pem. Zostaw tylko aktualny klucz (wymiana klucza: security-notes.md, sekcja 2).`,
    );
  }
  return join(directory, pems[0]);
}

const isInside = (child, parent) => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * Which key to use. The real key (default folder) only ever signs requests to
 * api.github.com; a test API needs an explicit throwaway key from elsewhere.
 */
/** @param {{ apiBaseUrl: string, keyFile?: string, appSlug: string, home?: string }} options */
export function chooseKeyFile({ apiBaseUrl, keyFile, appSlug, home = homedir() }) {
  const keyDir = defaultKeyDir(appSlug, home);
  if (apiBaseUrl === DEFAULT_API) {
    if (keyFile !== undefined) {
      throw new BotTokenError("--key-file jest tylko do testow z falszywym API (--api).");
    }
    return findKeyFile(keyDir);
  }
  if (keyFile === undefined) {
    throw new BotTokenError("Testowe API (--api) wymaga jawnego klucza testowego (--key-file).");
  }
  if (isInside(keyFile, keyDir)) {
    throw new BotTokenError(
      "Prawdziwy klucz aplikacji nie podpisuje zapytan do innego serwera niz api.github.com.",
    );
  }
  return keyFile;
}

const apiHeaders = (jwt) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${jwt}`,
  "X-GitHub-Api-Version": API_VERSION,
  "User-Agent": "bot-token-script",
});

async function apiCall(fetchImpl, url, init, what) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new BotTokenError(
      `${what}: brak polaczenia z API (${error?.cause?.code ?? error?.message ?? "blad sieci"}).`,
    );
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    // GitHub's error body carries only a message and a docs link, never a token.
    const message = typeof body?.message === "string" ? body.message.slice(0, 200) : "";
    throw new BotTokenError(`${what}: HTTP ${response.status}${message ? ` (${message})` : ""}.`);
  }
  return body;
}

/** Checks the installation itself: account, selected repositories only, permissions. */
export async function verifyInstallation({ apiBaseUrl, jwt, config, fetchImpl = fetch }) {
  const body = await apiCall(
    fetchImpl,
    `${apiBaseUrl}/app/installations/${config.installationId}`,
    { method: "GET", headers: apiHeaders(jwt) },
    "Odczyt instalacji aplikacji",
  );
  const problems = [];
  if (body?.account?.login?.toLowerCase() !== config.owner.toLowerCase()) {
    problems.push(
      `instalacja na koncie ${body?.account?.login ?? "?"}, oczekiwano ${config.owner}`,
    );
  }
  if (body?.repository_selection !== "selected") {
    problems.push(
      "aplikacja ma dostep do wszystkich repozytoriow (ma byc: Only select repositories)",
    );
  }
  const extra = checkPermissions(body?.permissions, { tolerateWorkflows: true });
  if (extra.length > 0) problems.push(`nadmiarowe uprawnienia: ${extra.join(", ")}`);
  if (problems.length > 0) {
    throw new BotTokenError(
      `Instalacja aplikacji niezgodna z BOOTSTRAP.md, krok 9: ${problems.join("; ")}.`,
    );
  }
  return { hasWorkflows: Object.hasOwn(body.permissions ?? {}, "workflows") };
}

/** POST /app/installations/{id}/access_tokens; returns { token, expiresAt }. */
export async function mintInstallationToken({ apiBaseUrl, jwt, config, fetchImpl = fetch }) {
  const body = await apiCall(
    fetchImpl,
    `${apiBaseUrl}/app/installations/${config.installationId}/access_tokens`,
    {
      method: "POST",
      headers: { ...apiHeaders(jwt), "Content-Type": "application/json" },
      body: JSON.stringify(buildTokenRequest(config)),
    },
    "Wydanie tokenu instalacji",
  );
  // No length or format check of the token: the format of ghs_ tokens changes.
  if (typeof body?.token !== "string" || body.token.length === 0) {
    throw new BotTokenError("Wydanie tokenu instalacji: odpowiedz bez tokenu.");
  }
  const problems = checkPermissions(body.permissions);
  const names = (body.repositories ?? []).map((repo) => repo?.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...config.repositories].sort())) {
    problems.push(`repozytoria tokenu: ${names.join(", ") || "brak listy"}`);
  }
  if (problems.length > 0) {
    throw new BotTokenError(`Token szerszy niz zamowiony (${problems.join("; ")}); nie loguje gh.`);
  }
  return { token: body.token, expiresAt: body.expires_at ?? null };
}

/** Logs gh in with the token on stdin; output is masked, the token never printed. */
export function loginGh(token, { ghPath = "gh", spawn = spawnSync } = {}) {
  const result = spawn(
    ghPath,
    ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--with-token"],
    { input: `${token}\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  const mask = (text) => (text ?? "").split(token).join("***").trim();
  if (result.error || result.status !== 0) {
    const detail = mask(result.stderr) || mask(result.stdout) || result.error?.message || "";
    throw new BotTokenError(
      `gh auth login --with-token nie powiodlo sie${detail ? `: ${detail}` : ""}.`,
    );
  }
}

export function parseArgs(argv) {
  const options = {
    config: ".github/bot.json",
    api: DEFAULT_API,
    keyFile: undefined,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") options.config = argv[++i];
    else if (arg === "--api") options.api = argv[++i];
    else if (arg === "--key-file") options.keyFile = argv[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new BotTokenError(`Nieznany argument: ${arg}`);
  }
  if (!options.config || !options.api || (options.keyFile !== undefined && !options.keyFile)) {
    throw new BotTokenError("Brak wartosci argumentu.");
  }
  options.api = options.api.replace(/\/+$/, "");
  if (!/^https:\/\/|^http:\/\/127\.0\.0\.1[:/]|^http:\/\/localhost[:/]/.test(`${options.api}/`)) {
    throw new BotTokenError("--api musi byc adresem https albo lokalnym serwerem testowym.");
  }
  return options;
}

/**
 * @param {string[]} argv
 * @param {{ fetchImpl?: typeof fetch, log?: (line: string) => void, home?: string, spawn?: any }} [deps]
 */
export async function run(
  argv,
  { fetchImpl = fetch, log = console.log, home = homedir(), spawn } = {},
) {
  const options = parseArgs(argv);
  const config = parseBotConfig(readFileSync(options.config, "utf8"));
  const keyFile = chooseKeyFile({
    apiBaseUrl: options.api,
    keyFile: options.keyFile,
    appSlug: config.appSlug,
    home,
  });
  const jwt = signAppJwt({ appId: config.appId, privateKey: readFileSync(keyFile, "utf8") });

  const { hasWorkflows } = await verifyInstallation({
    apiBaseUrl: options.api,
    jwt,
    config,
    fetchImpl,
  });
  log(
    `OK: instalacja ${config.installationId} na koncie ${config.owner}, tylko wybrane repozytoria, bez uprawnien administracyjnych.`,
  );
  if (hasWorkflows)
    log(
      "UWAGA: aplikacja ma uprawnienie Workflows (wymaga decyzji wlasciciela w docs/decisions.md).",
    );

  const { token, expiresAt } = await mintInstallationToken({
    apiBaseUrl: options.api,
    jwt,
    config,
    fetchImpl,
  });
  const until = expiresAt ? new Date(expiresAt).toLocaleTimeString("pl-PL") : "za godzine";
  log(`OK: token instalacji dla ${config.repositories.join(" i ")}, wazny do ${until}.`);

  if (options.dryRun) {
    log("Proba (--dry-run): gh auth login pominiete.");
    return { loggedIn: false, expiresAt };
  }
  loginGh(token, spawn ? { spawn } : {});
  log(`OK: gh zalogowane jako ${config.appSlug}[bot].`);
  return { loggedIn: true, expiresAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    // Messages never contain the token or the key: both stay in local variables.
    const text =
      error instanceof BotTokenError ? error.message : `${error?.name}: ${error?.message}`;
    process.stderr.write(`${text}\n`);
    process.exit(1);
  }
}
