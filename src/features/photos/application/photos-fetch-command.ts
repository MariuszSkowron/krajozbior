import { auditOperatorSchema, auditReasonSchema, type AuditEntry } from "@/lib/db/operations-audit";

import {
  DEFAULT_FETCH_LIMIT,
  fetchCommonsPhotos,
  requeueMissingFiles,
  type PhotoFetchDeps,
  type PhotoFetchReport,
} from "./fetch-photos";

// Polecenie `npm run photos:fetch` (E4-2a): argumenty, blokada doradcza, przebieg, wpis
// `photos_fetch` w dzienniku operacji. Bez wejścia i wyjścia procesu: wywołujący (skrypt albo test)
// dostaje wiersze do wypisania i kod wyjścia.
// Kody wyjścia: 0 gotowe, 1 awaria, 2 błąd argumentów, 3 odmowa (poprzednie pobieranie trwa).

export const MAX_LIMIT = 5000;

export type PhotosSession = Readonly<{
  /** Wspólna blokada `photos:fetch` i `photos:sweep`; `false`, gdy trzyma ją inny proces. */
  tryLock: () => Promise<boolean>;
  writeAudit: (entry: AuditEntry) => Promise<void>;
  close: () => Promise<void>;
}>;

export type PhotosFetchCommandDeps = Readonly<{
  openSession: () => Promise<{ session: PhotosSession; fetch: PhotoFetchDeps }>;
}>;

export type CommandOutput = Readonly<{
  exitCode: 0 | 1 | 2 | 3;
  stdout: string[];
  stderr: string[];
}>;

type ParsedArgs = Readonly<{
  operator: string;
  reason: string;
  limit: number;
  retryFailed: boolean;
  refetchMissing: boolean;
  organizationSlug?: string;
}>;

const FLAGS_WITH_VALUE = new Set(["--operator", "--reason", "--limit", "--org-slug"]);
const FLAGS_SWITCH = new Set(["--retry-failed", "--refetch-missing"]);

export function parsePhotosFetchArgs(
  argv: readonly string[],
): { ok: true; args: ParsedArgs } | { ok: false; message: string } {
  const values = new Map<string, string>();
  const switches = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;

    if (flag === "--") {
      continue;
    }

    if (FLAGS_SWITCH.has(flag)) {
      switches.add(flag);
    } else if (FLAGS_WITH_VALUE.has(flag)) {
      const value = argv[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `brak wartości przy ${flag}.` };
      }

      values.set(flag, value);
      index += 1;
    } else {
      return { ok: false, message: "nieznany argument." };
    }
  }

  const operator = auditOperatorSchema.safeParse(values.get("--operator") ?? "");
  const reason = auditReasonSchema.safeParse(values.get("--reason") ?? "");

  if (!operator.success || !reason.success) {
    return {
      ok: false,
      message:
        "wymagane są --operator (do 80 znaków) i --reason (do 400 znaków, bez adresu e-mail).",
    };
  }

  const rawLimit = values.get("--limit");
  const limit = rawLimit === undefined ? DEFAULT_FETCH_LIMIT : Number(rawLimit);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { ok: false, message: `--limit musi być liczbą całkowitą od 1 do ${MAX_LIMIT}.` };
  }

  const organizationSlug = values.get("--org-slug");

  if (organizationSlug !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(organizationSlug)) {
    return { ok: false, message: "--org-slug ma niepoprawny kształt." };
  }

  return {
    ok: true,
    args: {
      operator: operator.data,
      reason: reason.data,
      limit,
      retryFailed: switches.has("--retry-failed"),
      refetchMissing: switches.has("--refetch-missing"),
      ...(organizationSlug === undefined ? {} : { organizationSlug }),
    },
  };
}

function auditDetails(
  report: PhotoFetchReport,
  args: ParsedArgs,
  requeued: number,
): Record<string, unknown> {
  // Same liczby i kody powodów; żadnych nazw plików, adresów ani tytułów (dziennik jest tylko do dopisywania).
  return {
    phase: "finish",
    fetched: report.fetched,
    failed: report.failed,
    skipped: report.skipped,
    remaining: report.remaining,
    requeued,
    retry_failed: args.retryFailed,
    reasons: report.reasons,
    ...(report.stoppedBy === undefined ? {} : { stopped_by: report.stoppedBy }),
  };
}

export async function runPhotosFetch(
  argv: readonly string[],
  deps: PhotosFetchCommandDeps,
): Promise<CommandOutput> {
  const parsed = parsePhotosFetchArgs(argv);

  if (!parsed.ok) {
    return { exitCode: 2, stdout: [], stderr: [`photos:fetch: ${parsed.message}`] };
  }

  const { args } = parsed;
  let opened: Awaited<ReturnType<PhotosFetchCommandDeps["openSession"]>>;

  try {
    opened = await deps.openSession();
  } catch {
    return {
      exitCode: 1,
      stdout: [],
      stderr: ["photos:fetch: nie udało się połączyć z bazą ani przygotować katalogu zdjęć."],
    };
  }

  const { session, fetch } = opened;

  try {
    if (!(await session.tryLock())) {
      return {
        exitCode: 3,
        stdout: [],
        stderr: ["Poprzednie pobieranie jeszcze trwa. Spróbuj ponownie za kilka minut."],
      };
    }

    let requeued = 0;

    try {
      if (args.refetchMissing) {
        requeued = await requeueMissingFiles(fetch.repository, fetch.storage);
      }

      const report = await fetchCommonsPhotos(fetch, {
        limit: args.limit,
        retryFailed: args.retryFailed,
        ...(args.organizationSlug === undefined ? {} : { organizationSlug: args.organizationSlug }),
      });

      await session.writeAudit({
        operation: "photos_fetch",
        operator: args.operator,
        reason: args.reason,
        subjectUserId: null,
        organizationId: null,
        before: null,
        after: null,
        outcome: "applied",
        code: null,
        details: auditDetails(report, args, requeued),
      });

      const stderr: string[] = [];

      if (report.stoppedBy !== undefined) {
        stderr.push(
          "Pobieranie wstrzymano: za mało wolnego miejsca na dysku albo nie da się go odczytać.",
        );
      }

      if (report.remaining > 0) {
        stderr.push(`Zostało ${report.remaining} zdjęć do pobrania, uruchom polecenie ponownie.`);
      }

      return {
        exitCode: 0,
        stdout: [JSON.stringify({ outcome: "applied", ...report, requeued })],
        stderr,
      };
    } catch (error) {
      const sqlState = (error as { code?: unknown } | null)?.code;

      // Wpis o awarii jest dopisywany najlepiej jak się da; sam nie może zasłonić awarii.
      await session
        .writeAudit({
          operation: "photos_fetch",
          operator: args.operator,
          reason: args.reason,
          subjectUserId: null,
          organizationId: null,
          before: null,
          after: null,
          outcome: "rejected",
          code: "photos_fetch_failed",
          details: {
            phase: "finish",
            ...(typeof sqlState === "string" && /^[0-9A-Z]{5}$/.test(sqlState)
              ? { sqlstate_class: sqlState.slice(0, 2) }
              : {}),
          },
        })
        .catch(() => undefined);

      return {
        exitCode: 1,
        stdout: [],
        stderr: [
          "photos:fetch przerwany awarią; zapisane wiersze zostają, polecenie można ponowić.",
        ],
      };
    }
  } finally {
    await session.close().catch(() => undefined);
  }
}
