import { DEFAULT_MIN_FREE_PERCENT } from "./limits";

export type DiskSpace = { freeBytes: number; totalBytes: number };

export type FreeSpaceVerdict =
  { ok: true; freePercent: number } | { ok: false; reason: "uploads_paused"; freePercent: number };

/** Parsuje `MEDIA_MIN_FREE_PERCENT`; niepoprawna albo pusta wartość daje domyślne 15%. */
export function parseMinFreePercent(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MIN_FREE_PERCENT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return DEFAULT_MIN_FREE_PERCENT;
  return value;
}

/** Strażnik wolnego miejsca (5.7): poniżej progu wgrywanie i pobieranie są wstrzymane. */
export function evaluateFreeSpace(space: DiskSpace, minFreePercent: number): FreeSpaceVerdict {
  const freePercent = space.totalBytes > 0 ? (space.freeBytes / space.totalBytes) * 100 : 0;
  if (freePercent < minFreePercent) return { ok: false, reason: "uploads_paused", freePercent };
  return { ok: true, freePercent };
}
