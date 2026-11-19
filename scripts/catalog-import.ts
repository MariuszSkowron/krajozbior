// Loads an approved collection file into the local database of one organization
// as a curator (drafts; idempotent, edits made in the panel are kept). Local
// operator command: refuses in production and on a database outside localhost.
// Prints a JSON summary on stdout (no e-mails, no addresses), short Polish
// hints on stderr, and writes the per entity report to .ai/tmp/catalog-import/
// (ignored by git). Exit codes: 0 done/unchanged/preview, 2 input error,
// 3 domain refusal, 1 failure.
//
// Run with:
//   npm run catalog:import -- --dry-run --file <plik.ndjson> [--profile full|public]
//   npm run catalog:import -- --dry-run --file <plik> --org-slug <slug> --curator-email <e-mail>
//   npm run catalog:import -- --file <plik> --org-slug <slug> --curator-email <e-mail>
//
// The validation alone (--dry-run without the organization flags) needs no
// database and no database variables: the database module is imported only
// when both organization flags are present.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { runCatalogImport } from "../src/features/catalog/application/catalog-import-command";

async function main() {
  const output = await runCatalogImport(process.argv.slice(2), {
    readFile: (path) => readFile(path, "utf8"),
    connect: async () =>
      (
        await import("../src/features/catalog/infrastructure/catalog-import-runner")
      ).connectCatalogImport(),
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
