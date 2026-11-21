import { DEFAULT_MIN_FREE_PERCENT } from "./limits";

export type DiskSpace = { freeBytes: number; totalBytes: number };

export type FreeSpaceVerdict =
  | { ok: true; freePercent: number }
  | { ok: false; reason: "uploads_paused"; freePercent: number }
  | { ok: false; reason: "space_unreadable" };

/** Parsuje `MEDIA_MIN_FREE_PERCENT`; niepoprawna albo pusta wartość daje domyślne 15%. */
export function parseMinFreePercent(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_MIN_FREE_PERCENT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return DEFAULT_MIN_FREE_PERCENT;
  return value;
}

/** Strażnik wolnego miejsca (5.7): poniżej progu wgrywanie i pobieranie są wstrzymane. */
export function evaluateFreeSpace(
  space: DiskSpace,
  minFreePercent: number,
): Exclude<FreeSpaceVerdict, { reason: "space_unreadable" }> {
  const freePercent = space.totalBytes > 0 ? (space.freeBytes / space.totalBytes) * 100 : 0;
  if (freePercent < minFreePercent) return { ok: false, reason: "uploads_paused", freePercent };
  return { ok: true, freePercent };
}

/**
 * Kontrakt strażnika: gdy odczyt miejsca zawiedzie (np. `statfs`), wynik to `space_unreadable`,
 * czyli wgrywanie i pobieranie są wstrzymane (przy awarii odczytu blokujemy zapis, nie puszczamy).
 */
export async function checkFreeSpace(
  readSpace: () => Promise<DiskSpace>,
  minFreePercent: number,
): Promise<FreeSpaceVerdict> {
  try {
    return evaluateFreeSpace(await readSpace(), minFreePercent);
  } catch {
    return { ok: false, reason: "space_unreadable" };
  }
}
