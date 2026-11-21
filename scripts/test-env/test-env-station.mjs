#!/usr/bin/env node
// Station names and ports of the local test environment (scripts/test-env/*.ps1).
//
// Every checkout ("station") gets its own container names, preferred ports and
// state folder, so two worktrees (e.g. .worktrees/ws-1 and .worktrees/ws-2) can
// run test environments at the same time without removing each other's
// containers. The station is, in this order:
//   1. TEST_ENV_STATION (only for diagnosis, e.g. a second environment from one checkout),
//   2. "main" for the main checkout (its .git is a folder),
//   3. the folder name of the worktree (its .git is a file), e.g. "ws-3".
// Preferred ports are deterministic per station and never 3000 (developer app),
// 3300 (the permanent local demo) or 5432 (developer database):
//   app 3100 + slot, integration PostgreSQL 55432 + 10*slot, E2E PostgreSQL 55433 + 10*slot.
// The slot is 0 for "main", N for "ws-N" (1..49), and a hash in 50..99 for any other name.
// A taken preferred port falls back to a free port chosen by the system (test-env-up.ps1).
//
// CLI (used by the PowerShell scripts):
//   node scripts/test-env/test-env-station.mjs config [--root <dir>]   -> JSON on stdout
//   node scripts/test-env/test-env-station.mjs own [--root <dir>] [names...]
//     -> those of the given container names that belong to this station, one per line
import { statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CONTAINER_PREFIX = "krajozbior-testenv-";
export const RESERVED_PORTS = Object.freeze([3000, 3300, 5432]);
export const APP_PORT_BASE = 3100;
export const PG_PORT_BASE = 55432;
export const SLOT_COUNT = 100;
export const NAMED_SLOTS = 50;
export const MAIN_STATION = "main";
export const STATE_ROOT = ".data/test-env";

const STATION_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export class StationError extends Error {}

/**
 * Lower-case slug of a station name: letters, digits and single hyphens, at most 32 characters.
 * @param {string} raw
 * @returns {string}
 */
export function normalizeStation(raw) {
  const slug = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32)
    .replace(/-+$/, "");

  if (!STATION_PATTERN.test(slug)) {
    throw new StationError(`Invalid test-env station name: "${raw}"`);
  }
  return slug;
}

/**
 * @param {string} root
 * @returns {boolean} true when root is the main checkout (.git is a folder, not a worktree file)
 */
export function isMainCheckout(root) {
  try {
    return statSync(join(root, ".git")).isDirectory();
  } catch {
    return false;
  }
}

/**
 * @param {{ root: string, override?: string | undefined, mainCheckout: boolean }} input
 * @returns {string}
 */
export function resolveStation({ root, override, mainCheckout }) {
  if (override && override.trim() !== "") return normalizeStation(override);
  if (mainCheckout) return MAIN_STATION;
  return normalizeStation(basename(resolve(root)));
}

/**
 * 32-bit FNV-1a: a stable hash, the same on every machine and Node version.
 * @param {string} text
 * @returns {number}
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * @param {string} station
 * @returns {number} slot in 0..SLOT_COUNT-1
 */
export function stationSlot(station) {
  if (station === MAIN_STATION) return 0;
  const match = /^ws-(\d{1,2})$/.exec(station);
  if (match) {
    const n = Number(match[1]);
    if (n >= 1 && n < NAMED_SLOTS) return n;
  }
  return NAMED_SLOTS + (fnv1a(station) % (SLOT_COUNT - NAMED_SLOTS));
}

/**
 * @param {number} slot
 * @returns {{ app: number, integration: number, e2e: number }}
 */
export function stationPorts(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
    throw new StationError(`Slot out of range: ${slot}`);
  }
  return {
    app: APP_PORT_BASE + slot,
    integration: PG_PORT_BASE + 10 * slot,
    e2e: PG_PORT_BASE + 10 * slot + 1,
  };
}

/**
 * Container names of one station. The station is a non-empty slug, so these names never equal
 * another station's names, the names used before stations existed or any non-test-env container.
 * @param {string} station
 * @returns {{ e2e: string, integration: string }}
 */
export function containerNames(station) {
  const slug = normalizeStation(station);
  return {
    e2e: `${CONTAINER_PREFIX}${slug}-e2e-pg`,
    integration: `${CONTAINER_PREFIX}${slug}-int-pg`,
  };
}

/**
 * The filter of test-env-down.ps1: only exact names of this station's containers.
 * @param {readonly string[]} existing names reported by `docker ps -a`
 * @param {string} station
 * @returns {string[]}
 */
export function containersToRemove(existing, station) {
  const own = new Set(Object.values(containerNames(station)));
  return [...new Set(existing.map((name) => name.trim()))].filter((name) => own.has(name));
}

/**
 * @param {{ root: string, override?: string | undefined, mainCheckout: boolean }} input
 */
export function stationConfig(input) {
  const station = resolveStation(input);
  const slot = stationSlot(station);
  return {
    station,
    slot,
    ports: stationPorts(slot),
    containers: containerNames(station),
    stateDir: `${STATE_ROOT}/${station}`,
    label: `krajozbior.testenv.station=${station}`,
  };
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, cwd?: string }} [context]
 * @returns {string} text for stdout
 */
export function runCli(argv, { env = process.env, cwd = process.cwd() } = {}) {
  const [command, ...rest] = argv;
  let root = cwd;
  const names = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--root") {
      root = rest[i + 1] ?? "";
      i += 1;
    } else {
      names.push(rest[i]);
    }
  }
  const config = stationConfig({
    root,
    override: env.TEST_ENV_STATION,
    mainCheckout: isMainCheckout(root),
  });

  if (command === "config") return `${JSON.stringify(config)}\n`;
  if (command === "own") {
    return containersToRemove(names, config.station)
      .map((name) => `${name}\n`)
      .join("");
  }
  throw new StationError(`Unknown command: ${command ?? "(none)"} (allowed: config, own)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(runCli(process.argv.slice(2)));
  } catch (error) {
    const text = error instanceof StationError ? error.message : String(error);
    process.stderr.write(`${text}\n`);
    process.exit(1);
  }
}
