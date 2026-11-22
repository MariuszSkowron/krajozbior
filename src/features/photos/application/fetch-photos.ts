import { createHash, randomUUID } from "node:crypto";

import type { MediaStorage } from "@/features/media/application/media-storage";
import type { FreeSpaceVerdict } from "@/features/media/domain/free-space";
import { MediaProcessingError } from "@/features/media/domain/processing-error";
import type { ProcessedImage } from "@/features/media/infrastructure/image-processor";

import { buildCommonsThumbUrl } from "../domain/commons-url";
import { decideVersion, type CommonsVersionLookup } from "../domain/commons-version";
import type { CommonsFetchResult } from "../infrastructure/commons-http";

// `photos:fetch` (E4-2a, spec 5.5 i 5.11.5): wiersze `commons_import` w stanie `pending_fetch`
// dostają plik. Jedna próba na wiersz w jednym przebiegu; po trzeciej nieudanej wiersz dostaje
// `fetch_failed` (zdjęcie niewidoczne). Porty (baza, HTTP, obróbka, dysk, zegar) wstrzykuje
// wywołujący, więc test podstawia atrapy, a prawdziwy jest tylko potok obróbki z E4-0a.

export const MAX_FETCH_ATTEMPTS = 3;
/** Najwyżej jedno żądanie na sekundę (uprzejmość wobec Commons). */
export const MIN_REQUEST_INTERVAL_MS = 1000;
/** Domyślny `--limit`: ok. 10 minut pracy przy 1 żądaniu na sekundę z obróbką (5.11.5, A-S8). */
export const DEFAULT_FETCH_LIMIT = 300;

export type PendingPhoto = Readonly<{
  id: string;
  commonsFile: string;
  sourceWidth: number | null;
  fetchAttempts: number;
  /** Dzień przebiegu doboru; wersja pliku nowsza niż on jest odrzucana. */
  retrievedAt: Date | null;
  licenseCode: string;
}>;

export type MarkReadyValues = Readonly<{
  storageKey: string;
  width: number;
  height: number;
  contentSha256: Uint8Array;
}>;

export interface PhotoFetchRepository {
  /** Najstarsze najpierw; `retryFailed` dodaje wiersze `fetch_failed`. */
  listPending(request: {
    limit: number;
    retryFailed: boolean;
    organizationSlug?: string;
  }): Promise<readonly PendingPhoto[]>;
  /** `duplicate`, gdy miejsce ma już zdjęcie o tym skrócie (`23505`). */
  markReady(photoId: string, values: MarkReadyValues): Promise<"ok" | "duplicate" | "gone">;
  /** Zapisuje nieudaną próbę: nowa liczba prób i stan (`pending_fetch` albo `fetch_failed`). */
  recordFailure(
    photoId: string,
    attempts: number,
    state: "pending_fetch" | "fetch_failed",
  ): Promise<void>;
  countPending(): Promise<number>;
  /** Wiersze `commons_import` w stanie `ready` z kluczem pliku (dla `--refetch-missing`). */
  listReady(): Promise<readonly Readonly<{ id: string; storageKey: string }>[]>;
  /** `ready` → `pending_fetch` bez pliku i bez prób (plik zniknął z dysku). */
  requeue(photoId: string): Promise<void>;
}

/**
 * `--refetch-missing` [P]: wiersze `ready`, których pliku nie ma na wolumenie (np. po utracie
 * wolumenu), wracają do `pending_fetch`; zwraca ich liczbę. Plik główny sprawdzamy `exists`.
 */
export async function requeueMissingFiles(
  repository: PhotoFetchRepository,
  storage: MediaStorage,
): Promise<number> {
  let requeued = 0;

  for (const row of await repository.listReady()) {
    if (!(await storage.exists("place", row.storageKey, "main"))) {
      await repository.requeue(row.id);
      requeued += 1;
    }
  }

  return requeued;
}

export type OgBackfillReport = Readonly<{
  /** Zdjęcia, które dostały nowy `og.jpg`. */
  created: number;
  /** Zdjęcia bez `main.webp` albo takie, z których nie udało się zrobić JPEG. */
  failed: number;
  /** Przebieg przerwany: `space_unreadable` albo `uploads_paused`. */
  stoppedBy?: string;
}>;

/**
 * `--backfill-og`: jednorazowe uzupełnienie `og.jpg` dla zdjęć `ready` pobranych przed E4-3.
 * Jedno zdjęcie naraz (jeden proces potomny), każdy zapis atomowy z `fsync`; zdjęcia, które już
 * mają `og.jpg`, są pomijane, więc polecenie można powtarzać.
 */
export async function backfillOgFiles(
  deps: Pick<PhotoFetchDeps, "repository" | "storage" | "makeOg" | "checkSpace">,
  limit: number = Number.POSITIVE_INFINITY,
): Promise<OgBackfillReport> {
  let created = 0;
  let failed = 0;

  for (const row of await deps.repository.listReady()) {
    // `limit` liczy zdjęcia obrobione w tym przebiegu (udane i nieudane); reszta przy kolejnym.
    if (created + failed >= limit) {
      break;
    }

    // `read` daje `null` także dla pliku o zerowej długości (przerwany zapis), który trzeba zastąpić.
    if ((await deps.storage.read("place", row.storageKey, "og")) !== null) {
      continue;
    }

    const space = await deps.checkSpace();

    if (!space.ok) {
      return { created, failed, stoppedBy: space.reason };
    }

    const main = await deps.storage.read("place", row.storageKey, "main");

    if (main === null) {
      failed += 1;
      continue;
    }

    try {
      await deps.storage.storeOg("place", row.storageKey, await deps.makeOg(main));
      created += 1;
    } catch {
      failed += 1;
    }
  }

  return { created, failed };
}

export type PhotoFetchDeps = Readonly<{
  repository: PhotoFetchRepository;
  download: (address: string) => Promise<CommonsFetchResult>;
  /** Pytanie do API Commons o bieżącą wersję pliku (tuż przed pobraniem miniatury). */
  lookupVersion: (commonsFile: string) => Promise<CommonsVersionLookup>;
  /** Obróbka pobranego pliku (proces potomny); dla zdjęć oficjalnych z `ogJpeg: true`. */
  process: (bytes: Uint8Array) => Promise<ProcessedImage>;
  /** JPEG do `og:image` z istniejącego `main.webp` (proces potomny); tylko dla `--backfill-og`. */
  makeOg: (main: Uint8Array) => Promise<Uint8Array>;
  storage: MediaStorage;
  checkSpace: () => Promise<FreeSpaceVerdict>;
  sleep: (milliseconds: number) => Promise<void>;
  now?: () => number;
  newKey?: () => string;
}>;

export type PhotoFetchRequest = Readonly<{
  limit?: number;
  retryFailed?: boolean;
  organizationSlug?: string;
}>;

export type PhotoFetchReport = Readonly<{
  fetched: number;
  failed: number;
  /** Wiersze, których ten przebieg nie ruszył (przerwa z braku miejsca na dysku). */
  skipped: number;
  /** Wiersze dalej w stanie `pending_fetch` po przebiegu. */
  remaining: number;
  /** Powody nieudanych prób (same kody, bez adresów i nazw). */
  reasons: Readonly<Record<string, number>>;
  /** Przebieg przerwany: `space_unreadable` albo `uploads_paused`. */
  stoppedBy?: string;
}>;

type Outcome = Readonly<{ ok: true } | { ok: false; reason: string; final?: boolean }>;

async function fetchOne(deps: PhotoFetchDeps, photo: PendingPhoto): Promise<Outcome> {
  const address =
    photo.sourceWidth === null ? null : buildCommonsThumbUrl(photo.commonsFile, photo.sourceWidth);

  if (address === null) {
    return { ok: false, reason: "bad_source" };
  }

  // Miniatura zawsze pochodzi z wersji bieżącej, a każdy może wgrać nową. Pobieramy tylko wersję
  // nie nowszą niż dzień doboru, pod tą samą nazwą i z tą samą licencją; inaczej koniec bez prób.
  const verdict = decideVersion(await deps.lookupVersion(photo.commonsFile), {
    commonsFile: photo.commonsFile,
    sourceWidth: photo.sourceWidth,
    licenseCode: photo.licenseCode,
    retrievedAt: photo.retrievedAt,
  });

  if (!verdict.ok) {
    return {
      ok: false,
      reason: verdict.reason,
      ...(verdict.reason === "api_error" ? {} : { final: true }),
    };
  }

  const downloaded = await deps.download(address);

  if (!downloaded.ok) {
    return { ok: false, reason: downloaded.reason };
  }

  // Plik pobrany jest tylko wejściem: obróbka usuwa go od razu po wyniku albo błędzie, a na dysku
  // zostaje wyłącznie przetworzona kopia (budżet 300 KB, krótszy bok bez progu dla Commons).
  let processed: ProcessedImage;

  try {
    processed = await deps.process(downloaded.bytes);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof MediaProcessingError ? error.code : "processing_failed",
    };
  }

  const key = (deps.newKey ?? randomUUID)();
  const sha = createHash("sha256").update(processed.main).digest();

  try {
    // JPEG do podglądu linku (`og`) powstaje tu, w procesie potomnym obróbki, i trafia na dysk
    // razem z resztą (trasa `/media` tylko go serwuje).
    await deps.storage.store("place", key, {
      main: processed.main,
      w400: processed.thumb,
      ...(processed.og === undefined ? {} : { og: processed.og }),
    });
  } catch {
    return { ok: false, reason: "storage_failed" };
  }

  let marked: "ok" | "duplicate" | "gone";

  try {
    marked = await deps.repository.markReady(photo.id, {
      storageKey: key,
      width: processed.width,
      height: processed.height,
      contentSha256: sha,
    });
  } catch (error) {
    await deps.storage.remove("place", key).catch(() => undefined);

    throw error;
  }

  if (marked === "gone") {
    // Wiersz zniknął w trakcie pobierania (kurator usunął zdjęcie albo miejsce): plik jest
    // niepotrzebny, a reszta przebiegu toczy się dalej.
    await deps.storage.remove("place", key).catch(() => undefined);

    return { ok: false, reason: "gone", final: true };
  }

  if (marked === "duplicate") {
    await deps.storage.remove("place", key).catch(() => undefined);

    // Ten sam obraz już jest przy miejscu; kolejna próba nic nie zmieni.
    return { ok: false, reason: "duplicate", final: true };
  }

  return { ok: true };
}

export async function fetchCommonsPhotos(
  deps: PhotoFetchDeps,
  request: PhotoFetchRequest = {},
): Promise<PhotoFetchReport> {
  const now = deps.now ?? Date.now;
  const rows = await deps.repository.listPending({
    limit: request.limit ?? DEFAULT_FETCH_LIMIT,
    retryFailed: request.retryFailed ?? false,
    ...(request.organizationSlug === undefined
      ? {}
      : { organizationSlug: request.organizationSlug }),
  });
  const reasons: Record<string, number> = {};
  let fetched = 0;
  let failed = 0;
  let skipped = 0;
  let stoppedBy: string | undefined;
  let lastRequestAt: number | null = null;

  for (const [index, photo] of rows.entries()) {
    // Strażnik wolnego miejsca przed każdym plikiem (5.7); przy awarii odczytu też wstrzymuje.
    const space = await deps.checkSpace();

    if (!space.ok) {
      stoppedBy = space.reason;
      skipped = rows.length - index;
      break;
    }

    if (lastRequestAt !== null) {
      const wait = MIN_REQUEST_INTERVAL_MS - (now() - lastRequestAt);

      if (wait > 0) {
        await deps.sleep(wait);
      }
    }

    lastRequestAt = now();

    const outcome = await fetchOne(deps, photo);

    if (outcome.ok) {
      fetched += 1;
      continue;
    }

    failed += 1;
    reasons[outcome.reason] = (reasons[outcome.reason] ?? 0) + 1;

    const attempts = photo.fetchAttempts + 1;

    await deps.repository.recordFailure(
      photo.id,
      attempts,
      outcome.final === true || attempts >= MAX_FETCH_ATTEMPTS ? "fetch_failed" : "pending_fetch",
    );
  }

  return {
    fetched,
    failed,
    skipped,
    remaining: await deps.repository.countPending(),
    reasons,
    ...(stoppedBy === undefined ? {} : { stoppedBy }),
  };
}
