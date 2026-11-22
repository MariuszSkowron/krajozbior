import { parseArgs } from "node:util";

import { z } from "zod";

import { isLocalDatabaseUrl } from "@/lib/config/loopback";
import { auditOperatorSchema, auditReasonSchema } from "@/lib/db/operations-audit";

import {
  decodeNewsImportFile,
  parseNewsImportFile,
  type NewsImportEntry,
  type NewsImportFileError,
} from "./news-import-file";

// The pure part of the `news:import` command (E7-R2a, spec E7 section 14.4): arguments,
// the guards of the environment, the validation of the file and the mapping of the
// result to the exit code and the output. No I/O of its own: the file reader, the
// connection and the environment come from the caller, so the file is checked before
// any connection. The contract with the deployment mode (`wdroz.ps1 -Aktualnosci`,
// E7-R2b) is:
//
// - one JSON line on stdout that starts with `{"outcome"`: `preview` (`lines`, `states`),
//   `applied` (`lines`, `results`), `invalid` (`errorCount`, `errors`), `rejected` or
//   `refused` (`code`); the counters are `created`, `updated`, `unchanged`, `withdrawn`;
// - lines of the preview (the state and the title) on stdout, before that line;
// - exit codes: 0 done, unchanged or a preview, 2 an error of the file (only together with
//   `invalid`), 3 a refusal of the domain or of the environment (only together with
//   `rejected` or `refused`), 1 everything else (wrong arguments, a failure) and no JSON.
//
// The whole file is written in one transaction or not at all (S23).

/** The organizations the command may write to (D-33); the first one is the default. */
export const NEWS_EDITORIAL_ORG_SLUGS: readonly string[] = ["krajozbior-redakcja"];

export type NewsImportState = "created" | "updated" | "unchanged" | "withdrawn";

// `slug_taken` is not a refusal of `ops_put_news` (S6): a parallel write took the address
// between the read of the taken addresses and the write (SQLSTATE 23505). The command turns it
// into a refusal, so the owner can run the same file again (the address is then chosen anew).
export type NewsImportRejectCode =
  "invalid_transition" | "stale_link" | "too_many_news" | "slug_taken";

export type NewsImportRunRequest = Readonly<{
  entries: readonly NewsImportEntry[];
  orgSlug: string;
  preview: boolean;
  operator: string;
  reason: string;
}>;

export type NewsImportRunOutcome =
  /** `states` is aligned with `entries`. */
  | Readonly<{ kind: "done"; states: readonly NewsImportState[] }>
  | Readonly<{ kind: "refused"; code: "organization_not_found" }>
  /** `line` is the line of the file whose write the database refused; nothing is saved. */
  | Readonly<{ kind: "rejected"; code: NewsImportRejectCode; line: number }>;

export type NewsImportRunner = Readonly<{
  run: (request: NewsImportRunRequest) => Promise<NewsImportRunOutcome>;
  close: () => Promise<void>;
}>;

export type NewsImportDeps = Readonly<{
  /** Raw bytes (decoded strictly by the command); a string is accepted for tests only. */
  readFile: (path: string) => Promise<Uint8Array | string>;
  /** Connects as krajozbior_ops; called only when the database is needed. */
  connect: () => Promise<NewsImportRunner>;
  env: Readonly<{
    NODE_ENV?: string | undefined;
    DATABASE_OPS_URL?: string | undefined;
    /** Host name of `BETTER_AUTH_URL`, or undefined when the variable is not set. */
    host: string | undefined;
  }>;
  /**
   * The value of `--confirm-host`, read by the script itself (`scripts/news-import.ts`: the
   * deployment mode looks for that flag there to tell a version that knows the server mode).
   */
  confirmedHost?: string | undefined;
  /** The operator label when `--operator` is absent (a local run only). */
  defaultOperator?: string | undefined;
}>;

export type NewsImportCliResult = Readonly<{
  exitCode: 0 | 1 | 2 | 3;
  stdout: readonly string[];
  stderr: readonly string[];
}>;

const MAX_LISTED_ERRORS = 100;

const USAGE = [
  "Użycie:",
  "  news:import --dry-run --file <plik.ndjson>",
  "      podgląd: walidacja pliku i (gdy jest baza) stan każdej aktualności; nic nie zapisuje",
  "  news:import --file <plik.ndjson> [--operator <etykieta> --reason <powód>]",
  "      zapis całego pliku albo nic (lokalnie, nie w produkcji)",
  "  news:import --target server --confirm-host <host> --file <plik> [--dry-run | --operator <etykieta> --reason <powód>]",
  "      tryb serwera (kontener ops): zapis idzie do dziennika operacji",
].join("\n");

const argsSchema = z.strictObject({
  file: z.string().min(1).max(500),
  "dry-run": z.boolean().optional(),
  target: z.literal("server").optional(),
  "confirm-host": z.string().min(1).max(253).optional(),
  operator: auditOperatorSchema.optional(),
  reason: auditReasonSchema.optional(),
  "org-slug": z
    .string()
    .max(60)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
});

// Wrong arguments are a failure of the call, not of the file: exit 1 and no JSON line.
const inputError = (hint: string): NewsImportCliResult => ({
  exitCode: 1,
  stdout: [],
  stderr: [`Błąd wejścia: ${hint}`, USAGE],
});

const refusal = (code: string, hint: string): NewsImportCliResult => ({
  exitCode: 3,
  stdout: [JSON.stringify({ outcome: "refused", code })],
  stderr: [`Odmowa: ${hint}`],
});

const STATE_LABELS: Readonly<Record<NewsImportState | "checked", string>> = {
  created: "nowa",
  updated: "zmieniona",
  unchanged: "bez zmian",
  withdrawn: "wycofana",
  checked: "sprawdzona (bez porównania z bazą)",
};

function countStates(states: readonly NewsImportState[]): Record<NewsImportState, number> {
  const counts = { created: 0, updated: 0, unchanged: 0, withdrawn: 0 };

  for (const state of states) {
    counts[state] += 1;
  }

  return counts;
}

const entryLines = (
  entries: readonly NewsImportEntry[],
  states: readonly NewsImportState[] | null,
) =>
  entries.map(
    (entry, index) =>
      `${STATE_LABELS[states === null ? "checked" : states[index]!]} | ${entry.input.title}`,
  );

function invalidOutput(errors: readonly NewsImportFileError[]): NewsImportCliResult {
  return {
    exitCode: 2,
    stdout: [
      JSON.stringify({
        outcome: "invalid",
        errorCount: errors.length,
        errors: errors.slice(0, MAX_LISTED_ERRORS),
      }),
    ],
    stderr: [
      ...errors
        .slice(0, MAX_LISTED_ERRORS)
        .map((e) => (e.line === 0 ? `Plik: ${e.message}` : `Linia ${e.line}: ${e.message}`)),
      "Plik nie przeszedł walidacji; nic nie zapisano.",
    ],
  };
}

// Only the SQLSTATE class is shown: messages and SQL could carry identifiers or the
// connection string.
function failureOutput(error: unknown): NewsImportCliResult {
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
      "Operacja przerwana awarią; nic nie zapisano, można ponowić polecenie.",
      `SQLSTATE: ${sqlState === undefined ? "brak (błąd połączenia lub roli)" : `klasa ${sqlState.slice(0, 2)}`}`,
    ],
  };
}

export async function runNewsImport(
  argv: readonly string[],
  deps: NewsImportDeps,
): Promise<NewsImportCliResult> {
  let parsed;

  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        file: { type: "string" },
        "dry-run": { type: "boolean" },
        target: { type: "string" },
        "confirm-host": { type: "string" },
        operator: { type: "string" },
        reason: { type: "string" },
        "org-slug": { type: "string" },
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

  const { file: path, "dry-run": dryRun } = args.data;
  const preview = dryRun === true;
  const server = args.data.target === "server";
  const orgSlug = args.data["org-slug"] ?? NEWS_EDITORIAL_ORG_SLUGS[0]!;
  const { env } = deps;

  if (!NEWS_EDITORIAL_ORG_SLUGS.includes(orgSlug)) {
    return refusal(
      "organization_not_allowed",
      "aktualności zapisuje się tylko dla organizacji redakcji Krajozbioru.",
    );
  }

  if (server) {
    // The explicit server mode: the host is confirmed by the flag (a second barrier next to
    // the container the command runs in).
    const host = env.host?.toLowerCase();

    if (host === undefined || host === "") {
      return refusal(
        "host_not_configured",
        "brak adresu serwisu (BETTER_AUTH_URL), więc nie da się potwierdzić hosta.",
      );
    }

    if (deps.confirmedHost?.toLowerCase() !== host) {
      return refusal(
        "host_mismatch",
        "--confirm-host musi być równe nazwie hosta serwisu (z BETTER_AUTH_URL).",
      );
    }
  } else {
    // Local mode (the developer's machine and the showcase): never in production and never
    // on a database that is not on localhost. --operator and --reason are accepted here
    // too (the showcase passes them; every write leaves an entry in the audit).
    if (args.data["confirm-host"] !== undefined) {
      return inputError("--confirm-host działa tylko z --target server.");
    }

    if (env.NODE_ENV === "production") {
      return refusal("production", "bez --target server polecenie nie działa w produkcji.");
    }

    if (env.DATABASE_OPS_URL !== undefined && !isLocalDatabaseUrl(env.DATABASE_OPS_URL)) {
      return refusal(
        "non_local_database",
        "bez --target server polecenie działa tylko na bazie na localhost.",
      );
    }
  }

  const operator = args.data.operator ?? (server ? undefined : deps.defaultOperator);
  const reason = args.data.reason ?? (server ? undefined : "Lokalne wgranie aktualności z pliku");

  if (!preview && (operator === undefined || reason === undefined)) {
    return inputError("zapis wymaga --operator i --reason (trafiają do dziennika operacji).");
  }

  const databaseConfigured = env.DATABASE_OPS_URL !== undefined && env.DATABASE_OPS_URL !== "";

  if (!databaseConfigured && (server || !preview)) {
    return inputError("brak DATABASE_OPS_URL: zapis i tryb serwera wymagają bazy.");
  }

  let raw: Uint8Array | string;

  try {
    raw = await deps.readFile(path);
  } catch {
    return inputError("nie można odczytać pliku.");
  }

  const decoded =
    typeof raw === "string" ? { ok: true as const, content: raw } : decodeNewsImportFile(raw);

  if (!decoded.ok) {
    return invalidOutput(decoded.errors);
  }

  const result = parseNewsImportFile(decoded.content);

  if (!result.ok) {
    return invalidOutput(result.errors);
  }

  const { entries } = result;

  if (!databaseConfigured) {
    // A local check of the file alone: no database, no states.
    return {
      exitCode: 0,
      stdout: [
        ...entryLines(entries, null),
        JSON.stringify({ outcome: "preview", lines: entries.length, compared: false }),
      ],
      stderr: ["Sama walidacja pliku: stan w bazie sprawdza dopiero podgląd z połączeniem z bazą."],
    };
  }

  let runner: NewsImportRunner | undefined;

  try {
    runner = await deps.connect();

    const outcome = await runner.run({
      entries,
      orgSlug,
      preview,
      operator: operator ?? "podglad",
      reason: reason ?? "Podglad aktualnosci",
    });

    if (outcome.kind === "refused") {
      return refusal(outcome.code, "organizacja redakcji nie istnieje w bazie.");
    }

    if (outcome.kind === "rejected") {
      const entry = entries.find((candidate) => candidate.line === outcome.line);

      return {
        exitCode: 3,
        stdout: [JSON.stringify({ outcome: "rejected", code: outcome.code, line: outcome.line })],
        stderr: [
          `Linia ${outcome.line}: baza odmówiła zapisu (${outcome.code}). Nic nie zapisano${entry === undefined ? "" : ` (id ${entry.id})`}.`,
        ],
      };
    }

    const counts = countStates(outcome.states);

    return {
      exitCode: 0,
      stdout: [
        ...entryLines(entries, outcome.states),
        JSON.stringify(
          preview
            ? { outcome: "preview", lines: entries.length, states: counts }
            : { outcome: "applied", lines: entries.length, results: counts },
        ),
      ],
      stderr: [],
    };
  } catch (error) {
    return failureOutput(error);
  } finally {
    await runner?.close().catch(() => undefined);
  }
}
