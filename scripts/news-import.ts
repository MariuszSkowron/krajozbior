// Loads the file of the editorial news into the database (E7-R2a, spec E7 section 14.4):
// one news item in its target state per line (NDJSON). A new line creates the news item,
// a changed one changes it, `"status":"withdrawn"` withdraws it; items missing from the
// file are not touched. The whole file is written in one transaction or not at all, as
// krajozbior_ops (DATABASE_OPS_URL) through `ops_put_news`, with an entry `news_import` of
// the operations audit in the same transaction. Without `--target server` the command
// refuses production and a database outside localhost (the developer's machine and the
// showcase); on the server it runs in the `ops` container with `--target server
// --confirm-host <host>`. It prints a JSON line that starts with {"outcome" on stdout
// (no text of the news), the state and the title of each item before it, and short Polish
// hints on stderr.
// Exit codes: 0 done/unchanged/preview, 2 error of the file, 3 refusal, 1 failure or wrong call.
//
// Run with:
//   npm run news:import -- --dry-run --file <plik.ndjson>
//   npm run news:import -- --file <plik.ndjson> --operator <etykieta> --reason <powod>
//   npm run news:import -- --target server --confirm-host <host> --file <plik> \
//     --operator <etykieta> --reason <powod>
//
// The validation alone (--dry-run without DATABASE_OPS_URL) needs no database.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { runNewsImport } from "../src/features/news/application/news-import-command";

function configuredHost(): string | undefined {
  const url = process.env.BETTER_AUTH_URL;

  if (url === undefined || url === "") {
    return undefined;
  }

  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// The host the person confirms with `--confirm-host` (server mode). The script reads the flag
// itself: the deployment mode (`wdroz.ps1 -Aktualnosci`) checks that this file handles it, to
// tell a version that knows the server mode from an older one. The command compares it with the
// host of BETTER_AUTH_URL; the other flags it parses itself and refuses the unknown ones.
function confirmedHost(argv: readonly string[]): string | undefined {
  const { values } = parseArgs({
    args: [...argv],
    options: { "confirm-host": { type: "string" } },
    strict: false,
  });
  const value = values["confirm-host"];

  return typeof value === "string" ? value : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const output = await runNewsImport(argv, {
    confirmedHost: confirmedHost(argv),
    readFile: (path) => readFile(path, "utf8"),
    connect: async () => {
      const [{ connectNewsImport }, { getOpsEnv }] = await Promise.all([
        import("../src/features/news/infrastructure/postgres-news-import-runner"),
        import("../src/lib/config/env"),
      ]);

      return connectNewsImport(getOpsEnv().DATABASE_OPS_URL);
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_OPS_URL: process.env.DATABASE_OPS_URL,
      host: configuredHost(),
    },
    defaultOperator: process.env.USERNAME ?? process.env.USER,
  });

  for (const line of output.stdout) console.log(line);
  for (const line of output.stderr) console.error(line);
  process.exitCode = output.exitCode;
}

main().catch(() => {
  console.error("news:import przerwany nieoczekiwanym błędem.");
  process.exitCode = 1;
});
