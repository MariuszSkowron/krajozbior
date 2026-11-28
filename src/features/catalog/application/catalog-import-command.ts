import { parseArgs } from "node:util";

import { z } from "zod";

import { parseImportFile, type ImportProfile } from "../domain/import-file";
import { MAX_COLLECTIONS_PER_LIST } from "../domain/limits";
import type { CatalogImportOutcome } from "./catalog-import-types";
import type { ValidImportFile } from "./catalog-import";
import { UnsafeImportEnvironmentError } from "./catalog-import-safety";
import {
  resultOfFailure,
  resultOfOutcome,
  sha256Hex,
  type ImportAuditBatch,
  type ImportAuditResult,
} from "./catalog-import-audit";
import { auditOperatorSchema, auditReasonSchema } from "@/lib/db/operations-audit";

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
      publish: boolean;
      remove: boolean;
    }>,
  ) => Promise<CatalogImportOutcome>;
  close: () => Promise<void>;
}>;

/** An entry "start" of the server loader; opaque to the command (the gateway knows what it holds). */
export type ImportAuditHandle = Readonly<{
  entryId: string;
  organizationId: string | null;
  subjectUserId: string | null;
}>;

/** The operations audit as the server loader sees it (role krajozbior_ops, spec 5.6 pt 5). */
export type ImportAuditGateway = Readonly<{
  /** Writes the entry "start" and returns its handle; throws when the audit cannot be written. */
  start: (
    request: Readonly<{
      batch: ImportAuditBatch;
      orgSlug: string;
      curatorEmail: string;
      operator: string;
      reason: string;
    }>,
  ) => Promise<ImportAuditHandle>;
  finish: (
    handle: ImportAuditHandle,
    request: Readonly<{
      batch: ImportAuditBatch;
      operator: string;
      reason: string;
      result: ImportAuditResult;
    }>,
  ) => Promise<void>;
}>;

/** The explicit server target (`--target server`); absent where the command runs only locally. */
export type CatalogImportServerDeps = Readonly<{
  /** Host name of `BETTER_AUTH_URL`, or undefined when the variable is not set. */
  host: string | undefined;
  /** Asks the person at a terminal to retype the host; absent without a terminal. */
  promptHost?: () => Promise<string | undefined>;
  /** Connects without the local guard (the guard of the server target is `host`). */
  connect: () => Promise<CatalogImportRunner>;
  audit: ImportAuditGateway;
}>;

export type CatalogImportCommandDeps = Readonly<{
  readFile: (path: string) => Promise<string>;
  /** Loads the database part lazily; called only when both organization flags are present. */
  connect: () => Promise<CatalogImportRunner>;
  server?: CatalogImportServerDeps;
}>;

/** The audit could not be written before the load: nothing was loaded. */
export class ImportAuditUnavailableError extends Error {
  constructor() {
    super("The operations audit is unavailable");
    this.name = "ImportAuditUnavailableError";
  }
}

const USAGE = [
  "Użycie:",
  "  catalog:import --dry-run --file <plik.ndjson> [--profile full|public]",
  "      sama walidacja pliku, bez bazy",
  "  catalog:import --dry-run --file <plik> --org-slug <slug> --curator-email <e-mail>",
  "      walidacja i podgląd stanu bazy (tylko informacja, nic nie zapisuje)",
  "  catalog:import --file <plik> --org-slug <slug> --curator-email <e-mail>",
  "      wgranie (idempotentne; ręczne zmiany z panelu zostają)",
  "  catalog:import --file <plik> --org-slug <slug> --curator-email <e-mail> --publish [--dry-run]",
  "      wgranie, a potem publikacja kolekcji z publish: true (tylko szkice niepublikowane i nieedytowane ręcznie)",
  "  catalog:import --file <plik> --org-slug <slug> --curator-email <e-mail> --remove",
  "      usunięcie tego, co wgrano z pliku, tylko przed publikacją (opublikowane i miejsca z wizytami zostają)",
  "  catalog:import --target server --confirm-host <host> --profile public --file <plik> --org-slug <slug> --curator-email <e-mail> --operator <etykieta> --reason <powód> [--dry-run] [--publish | --remove]",
  "      tryb serwera (tylko w kontenerze ops): szkice, z --publish także publikacja (te same reguły); zapis idzie do dziennika operacji",
].join("\n");

const argsSchema = z.strictObject({
  file: z.string().min(1).max(500),
  "dry-run": z.boolean().optional(),
  publish: z.boolean().optional(),
  remove: z.boolean().optional(),
  profile: z.enum(["full", "public"]).optional(),
  "org-slug": z
    .string()
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  "curator-email": z.email().max(254).optional(),
  // The server target (spec 5.6): only `server` exists; local is the default.
  target: z.literal("server").optional(),
  "confirm-host": z.string().min(1).max(253).optional(),
  operator: auditOperatorSchema.optional(),
  reason: auditReasonSchema.optional(),
});

const refusal = (code: string, hint: string): CatalogImportCliResult => ({
  exitCode: 3,
  stdout: [JSON.stringify({ outcome: "refused", code })],
  stderr: [`Odmowa: ${hint}`],
});

const inputError = (hint: string): CatalogImportCliResult => ({
  exitCode: 2,
  stdout: [],
  stderr: [`Błąd wejścia: ${hint}`, USAGE],
});

// Only the SQLSTATE class is shown: messages and SQL could carry identifiers
// of rows, of other organizations or the connection string (23503 included).
function failureOutput(error: unknown): CatalogImportCliResult {
  if (error instanceof ImportAuditUnavailableError) {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["Dziennik operacji jest niedostępny: nic nie wgrano. Można ponowić polecenie."],
    };
  }

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
        publish: { type: "boolean" },
        remove: { type: "boolean" },
        profile: { type: "string" },
        "org-slug": { type: "string" },
        "curator-email": { type: "string" },
        target: { type: "string" },
        "confirm-host": { type: "string" },
        operator: { type: "string" },
        reason: { type: "string" },
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
      "wgranie, publikacja i usuwanie wymagają --org-slug i --curator-email (bez nich jest tylko --dry-run).",
    );
  }

  const publish = args.data.publish === true;
  const remove = args.data.remove === true;

  if (publish && remove) {
    return inputError("--publish i --remove nie łączą się.");
  }
  // [P] The removal has no preview: what it keeps depends on visits the
  // curator cannot see, which only the delete itself finds out.
  if (remove && dryRun === true && orgSlug !== undefined) {
    return inputError(
      "--remove nie ma podglądu z bazą (sama walidacja pliku: bez flag organizacji).",
    );
  }

  const server = args.data.target === "server";
  const confirmHost = args.data["confirm-host"];
  const operator = args.data.operator;
  const reason = args.data.reason;

  // The flags of the server target mean nothing locally: refuse them instead
  // of silently ignoring a confirmation the person thinks has an effect.
  if (!server && (confirmHost !== undefined || operator !== undefined || reason !== undefined)) {
    return inputError("--confirm-host, --operator i --reason działają tylko z --target server.");
  }

  if (server) {
    // [P] Policy refusals use the exit code 3 (refusal), as in the spec.
    // `--publish` is allowed since D-68 under the same conditions as a load
    // (public profile, operator and reason for the write; the preview writes
    // nothing) and goes through the same use case as the local `--publish`.
    if (profile !== "public") {
      return refusal(
        "profile_not_public",
        "na serwerze wymagany jest profil public (--profile public): pola pomocnicze nie opuszczają komputera właściciela.",
      );
    }
    if (dryRun !== true && (operator === undefined || reason === undefined)) {
      return inputError("zapis na serwerze wymaga --operator i --reason (trafiają do dziennika).");
    }
    if (orgSlug !== undefined && deps.server === undefined) {
      return refusal("server_unavailable", "to uruchomienie nie obsługuje --target server.");
    }
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
      stderr: [
        "Plik nie przeszedł walidacji (numery linii i ścieżki pól w wyniku).",
        ...(result.errors.some((error) => error.code === "missing_attribution")
          ? [
              "Miejsce bez podpisu źródła (pole attribution) jest odrzucane: licencje źródeł wymagają podpisu.",
            ]
          : []),
      ],
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

  const request = {
    orgSlug,
    curatorEmail,
    file: result,
    preview: dryRun === true,
    publish,
    remove,
  };

  if (server) {
    return runOnServer(deps.server!, request, summary, {
      confirmHost,
      operator,
      reason,
      fileSha256: sha256Hex(content),
    });
  }

  let runner: CatalogImportRunner | undefined;

  try {
    runner = await deps.connect();

    return mapOutcome(await runner.run(request), summary);
  } catch (error) {
    return failureOutput(error);
  } finally {
    await runner?.close().catch(() => undefined);
  }
}

type RunnerRequest = Parameters<CatalogImportRunner["run"]>[0];

// The server target (spec 5.6). Order: the host is confirmed first (the flag
// always, the retyped name too at a terminal), then the runner connects (no
// write yet), then the entry "start" goes to the audit, and only when that
// succeeds does the load begin. A preview needs the host confirmation but
// changes nothing, so it leaves no entry.
async function runOnServer(
  server: CatalogImportServerDeps,
  request: RunnerRequest,
  summary: Readonly<Record<string, number>>,
  options: Readonly<{
    confirmHost: string | undefined;
    operator: string | undefined;
    reason: string | undefined;
    fileSha256: string;
  }>,
): Promise<CatalogImportCliResult> {
  const host = server.host?.toLowerCase();

  if (host === undefined || host === "") {
    return refusal(
      "host_not_configured",
      "brak adresu serwisu (BETTER_AUTH_URL), więc nie da się potwierdzić hosta.",
    );
  }
  if (options.confirmHost?.toLowerCase() !== host) {
    return refusal(
      "host_mismatch",
      "--confirm-host musi być równe nazwie hosta serwisu (z BETTER_AUTH_URL).",
    );
  }
  if (server.promptHost !== undefined) {
    const typed = (await server.promptHost())?.trim().toLowerCase();

    if (typed !== host) {
      return refusal("host_not_retyped", "przepisana nazwa hosta nie zgadza się z hostem serwisu.");
    }
  }

  let runner: CatalogImportRunner | undefined;

  try {
    runner = await server.connect();

    if (request.preview) {
      return mapOutcome(await runner.run(request), summary);
    }

    const { operator, reason } = options;

    if (operator === undefined || reason === undefined) {
      return inputError("zapis na serwerze wymaga --operator i --reason.");
    }

    const batch: ImportAuditBatch = {
      operation: request.remove ? "catalog_remove" : "catalog_import",
      batchId: request.file.batch.batchId,
      fileSha256: options.fileSha256,
      collections: request.file.collections.length,
      places: request.file.places.length,
      // D-68: the entries of a load with publication say so (`details.publish`).
      ...(request.publish ? { publish: true } : {}),
    };
    let handle;

    try {
      handle = await server.audit.start({
        batch,
        orgSlug: request.orgSlug,
        curatorEmail: request.curatorEmail,
        operator,
        reason,
      });
    } catch {
      throw new ImportAuditUnavailableError();
    }

    let outcome: CatalogImportOutcome;

    try {
      outcome = await runner.run(request);
    } catch (error) {
      await server.audit
        .finish(handle, {
          batch,
          operator,
          reason,
          result: resultOfFailure(batch, handle.entryId, error),
        })
        .catch(() => undefined);
      throw error;
    }

    const output = mapOutcome(outcome, summary);

    // The detailed report goes to the output only on the server (no files).
    const withReport: CatalogImportCliResult = {
      exitCode: output.exitCode,
      stdout: [
        ...output.stdout,
        ...(output.report === undefined ? [] : [JSON.stringify({ report: output.report })]),
      ],
      stderr: output.stderr,
    };

    try {
      await server.audit.finish(handle, {
        batch,
        operator,
        reason,
        result: resultOfOutcome(batch, handle.entryId, outcome),
      });
    } catch {
      return {
        exitCode: 1,
        stdout: withReport.stdout,
        stderr: [
          ...withReport.stderr,
          "Uwaga: wgranie się odbyło, ale wpis z wynikiem nie zapisał się w dzienniku operacji. Wpis „rozpoczęcie” jest w dzienniku; zgłoś to właścicielowi.",
        ],
      };
    }

    return withReport;
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
        stdout: [
          JSON.stringify({
            outcome: "refused",
            code: outcome.code,
            ...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
          }),
        ],
        stderr: [
          outcome.code === "curator_not_found"
            ? "Odmowa: nie ma konta z tym adresem e-mail (osoba najpierw loguje się sama)."
            : outcome.code === "removal_refused"
              ? "Odmowa podczas usuwania; cała operacja wycofana, nic nie usunięto."
              : "Odmowa: organizacja jest niedostępna dla tego konta (brak, zawieszona albo brak uprawnień). Nic nie zapisano.",
        ],
      };
    case "removed": {
      const counts: Record<string, Record<string, number>> = { collection: {}, place: {} };

      for (const report of outcome.reports) {
        const bucket = counts[report.kind]!;

        bucket[report.result] = (bucket[report.result] ?? 0) + 1;
      }

      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({
            outcome: "removed",
            ...summary,
            collectionResults: counts.collection,
            placeResults: counts.place,
          }),
        ],
        stderr: [],
        report: { reports: outcome.reports },
      };
    }
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
            ...(Object.keys(outcome.preview.photos ?? {}).length > 0
              ? { photoStates: outcome.preview.photos }
              : {}),
            orphanedKeys: outcome.preview.orphanedKeys,
            collectionLimitExceeded: outcome.preview.collectionLimitExceeded,
            ...(outcome.preview.extraRegions === undefined
              ? {}
              : { extraRegionsUpdated: outcome.preview.extraRegions.updated }),
            ...(outcome.preview.kind === undefined
              ? {}
              : { kindUpdated: outcome.preview.kind.updated }),
            ...(outcome.preview.publishable === undefined
              ? {}
              : {
                  publishable: outcome.preview.publishable,
                  publishableCount: outcome.preview.publishable.length,
                }),
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
      const publicationRefused = outcome.collections.filter((c) => c.publication === "refused");
      const counts: Record<string, number> = {};
      const placeCounts: Record<string, number> = {};
      const photoCounts: Record<string, number> = {};
      const publicationCounts: Record<string, number> = {};
      const extraRegionCounts: Record<string, number> = {};
      const kindCounts: Record<string, number> = {};

      for (const collection of outcome.collections) {
        counts[collection.result] = (counts[collection.result] ?? 0) + 1;

        if (collection.kind !== undefined) {
          kindCounts[collection.kind] = (kindCounts[collection.kind] ?? 0) + 1;
        }

        if (collection.extraRegions !== undefined) {
          extraRegionCounts[collection.extraRegions] =
            (extraRegionCounts[collection.extraRegions] ?? 0) + 1;
        }

        if (collection.publication !== undefined) {
          publicationCounts[collection.publication] =
            (publicationCounts[collection.publication] ?? 0) + 1;
        }

        for (const place of collection.places) {
          placeCounts[place.result] = (placeCounts[place.result] ?? 0) + 1;

          for (const photo of place.photos ?? []) {
            photoCounts[photo] = (photoCounts[photo] ?? 0) + 1;
          }
        }
      }

      const anyRefused = refused.length > 0 || publicationRefused.length > 0;

      return {
        exitCode: anyRefused ? 3 : 0,
        stdout: [
          JSON.stringify({
            outcome: anyRefused ? "partial" : "applied",
            batchId: outcome.batchId,
            ...summary,
            collectionResults: counts,
            placeResults: placeCounts,
            ...(Object.keys(photoCounts).length > 0 ? { photoResults: photoCounts } : {}),
            ...(Object.keys(publicationCounts).length > 0
              ? { publicationResults: publicationCounts }
              : {}),
            ...(Object.keys(extraRegionCounts).length > 0
              ? { extraRegionResults: extraRegionCounts }
              : {}),
            ...(Object.keys(kindCounts).length > 0 ? { kindResults: kindCounts } : {}),
            refused: refused.map((c) => ({ line: c.line, reason: c.refusal })),
            publicationRefused: publicationRefused.map((c) => ({
              line: c.line,
              reason: c.publicationRefusal,
            })),
            entities: total(counts) + total(placeCounts),
          }),
        ],
        stderr: anyRefused
          ? [
              "Część kolekcji lub publikacji odmówiono (kolekcja wycofana osobno; odmowa publikacji zostawia wgrany szkic); pozostałe wgrano. Szczegóły w raporcie.",
            ]
          : [],
        report: { batchId: outcome.batchId, collections: outcome.collections },
      };
    }
  }
}
