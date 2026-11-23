// Wybór miejsca na baner strony głównej gościa (R3, PR 4): jedno miejsce równomiernie spośród
// kandydatów. Losowanie jest wstrzykiwane (domyślnie `Math.random`), żeby testy go nie zgadywały.

/**
 * Wybiera jednego kandydata z jednakowym prawdopodobieństwem; pusta lista daje `null`.
 * `random` zwraca liczbę z przedziału [0, 1); wartość spoza niego (1, NaN) nie wychodzi poza listę.
 */
export function pickHomeBanner<T>(
  candidates: readonly T[],
  random: () => number = Math.random,
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  const raw = Math.floor(random() * candidates.length);
  const index = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), candidates.length - 1) : 0;

  return candidates[index] ?? null;
}
