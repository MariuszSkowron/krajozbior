// Validation of the optional extra arguments of test-env-test.ps1 (single test files).
// Only whitelisted shapes pass, so nothing else can be injected into Playwright/Vitest.
// CLI: node test-env-args.mjs <integration|e2e|all> [args...] -> prints one validated
// argument per line (exit 0) or the reason on stderr (exit 1).

import { pathToFileURL } from "node:url";

export class ArgsError extends Error {}

const FILTER = /^[\p{L}\p{N}_.:,/-]+$/u;
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

// Directories may start with one dot (e.g. .ai/tmp/...); ".." segments are rejected separately.
const SAFE_DIR = /^\.?[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

function validFile(arg, dir, suffix) {
  return (
    SAFE_PATH.test(arg) &&
    arg.startsWith(`${dir}/`) &&
    arg.endsWith(suffix) &&
    !arg.split("/").includes("..") &&
    !arg.includes("//")
  );
}

/** Returns the validated extra arguments for the suite, or throws ArgsError. */
export function validateExtraArgs(suite, extra) {
  if (extra.length === 0) return [];
  if (suite !== "e2e" && suite !== "integration") {
    throw new ArgsError("Extra arguments are allowed only with the suite e2e or integration.");
  }
  const e2e = suite === "e2e";
  const dir = e2e ? "e2e" : "tests";
  const suffix = e2e ? ".spec.ts" : ".test.ts";
  const filterFlag = e2e ? "-g" : "-t";
  const out = [];
  for (let i = 0; i < extra.length; i++) {
    const a = extra[i];
    if (a === filterFlag || (e2e && a === "--output")) {
      const value = extra[++i];
      if (value === undefined) throw new ArgsError(`${a} needs a value.`);
      if (a === "--output") {
        if (!SAFE_DIR.test(value) || value.split("/").includes("..") || value.includes("//")) {
          throw new ArgsError(`Invalid --output directory: ${value}`);
        }
      } else if (!FILTER.test(value) || value.startsWith("-")) {
        throw new ArgsError(
          `Invalid ${a} filter (allowed: letters, digits, _ . : , / -): ${value}`,
        );
      }
      out.push(a, value);
    } else if (validFile(a, dir, suffix)) {
      out.push(a);
    } else {
      throw new ArgsError(
        `Rejected argument: ${a} (allowed: relative ${dir}/...${suffix} paths, ${filterFlag} <filter>${e2e ? ", --output <dir>" : ""})`,
      );
    }
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const [suite = "all", ...extra] = process.argv.slice(2);
    for (const a of validateExtraArgs(suite, extra)) console.log(a);
  } catch (e) {
    if (!(e instanceof ArgsError)) throw e;
    console.error(`[test-env] ${e.message}`);
    process.exit(1);
  }
}
