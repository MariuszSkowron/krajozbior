import { parseArgs } from "node:util";

import { z } from "zod";

import { parseImportFile, type ImportProfile } from "../domain/import-file";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import type { CatalogImportOutcome } from "./catalog-import-types";
import type { ValidImportFile } from "./catalog-import";
import { UnsafeImportEnvironmentError } from "./catalog-import-safety";

// Pure part of the catalog:import command: arguments, file validation and the
// mapping of results to exit codes. No I/O of its own (the file reader and the
// connection come from the caller), so the validation runs without a database
// and without database variables. Exit codes: 0 done, unchanged or only a
// preview, 2 input error (arguments, file), 3 domain refusal, 1 failure.

/** Safeguards against a wrong file (the limits are [P]). */
export const MAX_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_COLLECTIONS = MAX_COLLECTIONS_PER_LIST;
export const MAX_IMPORT_PLACES = 2000;
const MAX_LISTED_ERRORS = 100;

export type CatalogImportCliResult = Readonly<{
  exitCode: 0 | 1 | 2 | 3;
  stdout: readonly string[];
  stderr: readonly string[];
  /** Per entity result of a real load, for the report file (keys, no e-mails). */
  report?: unknown;
}>;

export type CatalogImportRunner = Readonly<{
  run: (
    request: Readonly<{
      orgSlug: string;
      curatorEmail: string;
      file: ValidImportFile;
      preview: boolean;
    }>,
  ) => Promise<CatalogImportOutcome>;
  close: () => Promise<void>;
}>;

export type CatalogImportCommandDeps = Readonly<{
  readFile: (path: string) => Promise<string>;
  /** Loads the database part lazily; called only when both organization flags are present. */
  connect: () => Promise<CatalogImportRunner>;
}>;

const USAGE = [
  "Użycie:",
  "  catalog:import --dry-run --file <plik.ndjson> [--profile full|public]",
  "      sama walidacja pliku, bez bazy",
  "  catalog:import --dry-run --file <plik> --org-slug <slug> --curator-email <e-mail>",
  "      walidacja i podgląd stanu bazy (tylko informacja, nic nie zapisuje)",
  "  catalog:import --file <plik> --org-slug <slug> --curator-email <e-mail>",
  "      wgranie (idempotentne; ręczne zmiany z panelu zostają)",
].join("\n");

const argsSchema = z.strictObject({
  file: z.string().min(1).max(500),
  "dry-run": z.boolean().optional(),
  profile: z.enum(["full", "public"]).optional(),
  "org-slug": z
    .string()
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  "curator-email": z.email().max(254).optional(),
});

const inputError = (hint: string): CatalogImportCliResult => ({
  exitCode: 2,
  stdout: [],
  stderr: [`Błąd wejścia: ${hint}`, USAGE],
});

// Only the SQLSTATE class is shown: messages and SQL could carry identifiers
// of rows, of other organizations or the connection string (23503 included).
function failureOutput(error: unknown): CatalogImportCliResult {
  if (error instanceof UnsafeImportEnvironmentError) {
    return {
      exitCode: 3,
      stdout: [],
      stderr: [
        error.code === "production"
          ? "Odmowa: polecenie nie działa w środowisku produkcyjnym."
          : "Odmowa: polecenie działa tylko na bazie na localhost.",
      ],
    };
  }

  const code = (error as { code?: unknown } | null)?.code;
  const sqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  const name = error instanceof Error ? error.name : "";

  if (name === "ServerConfigError" && error instanceof Error) {
    return { exitCode: 1, stdout: [], stderr: [error.message] };
  }

  return {
    exitCode: 1,
    stdout: [],
    stderr: [
      "Operacja przerwana awarią; kolekcje wgrane wcześniej zostają, można ponowić polecenie.",
      `SQLSTATE: ${sqlState === undefined ? "brak (błąd połączenia lub roli)" : `klasa ${sqlState.slice(0, 2)}`}`,
    ],
  };
}

const total = (counts: Readonly<Record<string, number>>) =>
  Object.values(counts).reduce((sum, value) => sum + value, 0);

export async function runCatalogImport(
  argv: readonly string[],
  deps: CatalogImportCommandDeps,
): Promise<CatalogImportCliResult> {
  let parsed;

  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        file: { type: "string" },
        "dry-run": { type: "boolean" },
        profile: { type: "string" },
        "org-slug": { type: "string" },
        "curator-email": { type: "string" },
      },
    });
  } catch {
    return inputError("nieznana flaga albo flaga bez wartości.");
  }

  const args = argsSchema.safeParse(parsed.values);

  if (!args.success) {
    const flags = [...new Set(args.error.issues.map((issue) => issue.path.map(String).join(".")))];

    return inputError(
      `nieprawidłowa lub brakująca flaga: ${flags.map((f) => `--${f}`).join(", ")}.`,
    );
  }

  const { file: path, profile, "dry-run": dryRun } = args.data;
  const orgSlug = args.data["org-slug"];
  const curatorEmail = args.data["curator-email"]?.toLowerCase();

  // One flag without the other is an error, also in a preview.
  if ((orgSlug === undefined) !== (curatorEmail === undefined)) {
    return inputError("--org-slug i --curator-email podaje się razem albo wcale.");
  }
  if (dryRun !== true && orgSlug === undefined) {
    return inputError(
      "wgranie wymaga --org-slug i --curator-email (bez nich jest tylko --dry-run).",
    );
  }

  let content: string;

  try {
    content = await deps.readFile(path);
  } catch {
    return inputError("nie można odczytać pliku.");
  }

  if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_FILE_BYTES) {
    return inputError("plik jest większy niż dozwolone 8 MiB.");
  }

  const result = parseImportFile(content, { profile: (profile ?? "full") as ImportProfile });

  if (!result.ok) {
    return {
      exitCode: 2,
      stdout: [
        JSON.stringify({
          outcome: "invalid",
          errorCount: result.errors.length,
          errors: result.errors.slice(0, MAX_LISTED_ERRORS),
        }),
      ],
      stderr: ["Plik nie przeszedł walidacji (numery linii i ścieżki pól w wyniku)."],
    };
  }

  if (
    result.collections.length > MAX_IMPORT_COLLECTIONS ||
    result.places.length > MAX_IMPORT_PLACES
  ) {
    return inputError(
      `plik ma za dużo rekordów (najwyżej ${MAX_IMPORT_COLLECTIONS} kolekcji i ${MAX_IMPORT_PLACES} miejsc).`,
    );
  }

  const summary = {
    collections: result.collections.length,
    places: result.places.length,
    externalKeys: result.externalKeys.length,
  };

  if (orgSlug === undefined || curatorEmail === undefined) {
    return {
      exitCode: 0,
      stdout: [
        JSON.stringify({
          outcome: "valid",
          dryRun: true,
          ...summary,
          externalKeysToCheck: summary.externalKeys,
        }),
      ],
      stderr:
        summary.externalKeys > 0
          ? ["Uwaga: klucze miejsc spoza pliku sprawdza dopiero podgląd z bazą albo wgranie."]
          : [],
    };
  }

  let runner: CatalogImportRunner | undefined;

  try {
    runner = await deps.connect();

    const outcome = await runner.run({
      orgSlug,
      curatorEmail,
      file: result,
      preview: dryRun === true,
    });

    return mapOutcome(outcome, summary);
  } catch (error) {
    return failureOutput(error);
  } finally {
    await runner?.close().catch(() => undefined);
  }
}

function mapOutcome(
  outcome: CatalogImportOutcome,
  summary: Readonly<Record<string, number>>,
): CatalogImportCliResult {
  switch (outcome.kind) {
    case "refused":
      return {
        exitCode: 3,
        stdout: [JSON.stringify({ outcome: "refused", code: outcome.code })],
        stderr: [
          outcome.code === "curator_not_found"
            ? "Odmowa: nie ma konta z tym adresem e-mail (osoba najpierw loguje się sama)."
            : "Odmowa: organizacja jest niedostępna dla tego konta (brak, zawieszona albo brak uprawnień). Nic nie zapisano.",
        ],
      };
    case "rejected":
      return {
        exitCode: 2,
        stdout: [JSON.stringify({ outcome: "rejected", code: outcome.code, count: outcome.count })],
        stderr: [
          "Plik wskazuje miejsca spoza pliku, których organizacja nie ma. Nic nie zapisano.",
        ],
      };
    case "preview":
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({
            outcome: "preview",
            dryRun: true,
            ...summary,
            collectionStates: outcome.preview.collections,
            placeStates: outcome.preview.places,
            orphanedKeys: outcome.preview.orphanedKeys,
            collectionLimitExceeded: outcome.preview.collectionLimitExceeded,
          }),
        ],
        stderr: [
          "To podgląd informacyjny: wgranie przelicza stan od nowa, pod blokadą.",
          ...(outcome.preview.collectionLimitExceeded
            ? ["Uwaga: nowe kolekcje nie zmieszczą się w limicie organizacji."]
            : []),
        ],
      };
    case "done": {
      const refused = outcome.collections.filter((c) => c.result === "refused");
      const counts: Record<string, number> = {};
      const placeCounts: Record<string, number> = {};

      for (const collection of outcome.collections) {
        counts[collection.result] = (counts[collection.result] ?? 0) + 1;

        for (const place of collection.places) {
          placeCounts[place.result] = (placeCounts[place.result] ?? 0) + 1;
        }
      }

      return {
        exitCode: refused.length > 0 ? 3 : 0,
        stdout: [
          JSON.stringify({
            outcome: refused.length > 0 ? "partial" : "applied",
            batchId: outcome.batchId,
            ...summary,
            collectionResults: counts,
            placeResults: placeCounts,
            refused: refused.map((c) => ({ line: c.line, reason: c.refusal })),
            entities: total(counts) + total(placeCounts),
          }),
        ],
        stderr:
          refused.length > 0
            ? [
                "Część kolekcji odmówiono (każda wycofana osobno); pozostałe wgrano. Szczegóły w raporcie.",
              ]
            : [],
        report: { batchId: outcome.batchId, collections: outcome.collections },
      };
    }
  }
}
