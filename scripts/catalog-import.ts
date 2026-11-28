// Loads an approved collection file into the database of one organization as a
// curator (drafts; idempotent, edits made in the panel are kept). By default a
// local operator command: refuses in production and on a database outside
// localhost. The only way to a server database is the explicit mode
// `--target server` (F-K6, spec 5.6): the host must be confirmed, the profile is
// `public`, and the load is wrapped in two entries of the operations audit.
// It runs in the `ops` container on the server. Since D-68 the server mode
// also takes `--publish` (marker server-publish, read by scripts/ops/server/remote.sh),
// with the same rules as locally; its audit entries carry `publish: true`.
// Prints a JSON summary on stdout (no e-mails, no addresses), short Polish
// hints on stderr, and writes the per entity report to .ai/tmp/catalog-import/
// (ignored by git; on the server the report goes to stdout only).
// Exit codes: 0 done/unchanged/preview, 2 input error, 3 domain refusal, 1 failure.
//
// Run with:
//   npm run catalog:import -- --dry-run --file <plik.ndjson> [--profile full|public]
//   npm run catalog:import -- --dry-run --file <plik> --org-slug <slug> --curator-email <e-mail>
//   npm run catalog:import -- --file <plik> --org-slug <slug> --curator-email <e-mail>
//   npm run catalog:import -- --target server --confirm-host <host> --profile public \
//     --file <plik> --org-slug <slug> --curator-email <e-mail> --operator <etykieta> --reason <powód> [--publish]
//
// The validation alone (--dry-run without the organization flags) needs no
// database and no database variables: the database module is imported only
// when both organization flags are present.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { runCatalogImport } from "../src/features/catalog/application/catalog-import-command";
import type { ImportAuditGateway } from "../src/features/catalog/application/catalog-import-command";

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

// At a terminal the person retypes the host name (a second barrier next to the
// flag). Without a terminal only the flag counts.
async function promptHost(host: string | undefined): Promise<string | undefined> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });

  try {
    return await readline.question(
      `Zapis na serwer${host === undefined ? "" : ` ${host}`}. Przepisz nazwę hosta, żeby potwierdzić: `,
    );
  } finally {
    readline.close();
  }
}

const lazyAudit = (): ImportAuditGateway => {
  const gateway = async () => {
    const [{ createPostgresImportAudit }, { getOpsEnv }] = await Promise.all([
      import("../src/features/catalog/infrastructure/postgres-catalog-import-audit"),
      import("../src/lib/config/env"),
    ]);

    return createPostgresImportAudit(getOpsEnv().DATABASE_OPS_URL);
  };

  return {
    start: async (request) => (await gateway()).start(request),
    finish: async (handle, request) => (await gateway()).finish(handle, request),
  };
};

async function main() {
  const host = configuredHost();
  const interactive = process.stdin.isTTY === true && process.stderr.isTTY === true;
  const output = await runCatalogImport(process.argv.slice(2), {
    readFile: (path) => readFile(path, "utf8"),
    connect: async () =>
      (
        await import("../src/features/catalog/infrastructure/catalog-import-runner")
      ).connectCatalogImport(),
    server: {
      host,
      ...(interactive ? { promptHost: () => promptHost(host) } : {}),
      connect: async () =>
        (
          await import("../src/features/catalog/infrastructure/catalog-import-runner")
        ).connectCatalogImport("server"),
      audit: lazyAudit(),
    },
  });

  for (const line of output.stdout) console.log(line);
  for (const line of output.stderr) console.error(line);

  if (output.report !== undefined) {
    const directory = join(".ai", "tmp", "catalog-import");
    const file = join(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

    await mkdir(directory, { recursive: true });
    await writeFile(file, JSON.stringify(output.report, null, 2), "utf8");
    console.error(`Raport: ${file}`);
  }

  process.exitCode = output.exitCode;
}

main().catch(() => {
  console.error("catalog:import przerwany nieoczekiwanym błędem.");
  process.exitCode = 1;
});
