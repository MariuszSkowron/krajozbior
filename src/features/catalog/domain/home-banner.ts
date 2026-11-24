// Wybór miejsca na baner strony głównej gościa (R3, PR 4): jedno miejsce równomiernie spośród
// kandydatów. Losowanie jest wstrzykiwane (domyślnie `bannerRandom`), żeby testy go nie zgadywały.

/**
 * Liczba z przedziału [0, 1) z generatora kryptograficznego. Wybór zdjęcia nie jest zabezpieczeniem,
 * ale baner stoi też obok formularza logowania, a skaner kodu (CodeQL) traktuje tam `Math.random`
 * jako słabe losowanie — ten generator nie budzi wątpliwości i kosztuje tyle samo.
 */
export function bannerRandom(): number {
  const [value] = globalThis.crypto.getRandomValues(new Uint32Array(1));

  return Number(value) / 2 ** 32;
}

/**
 * Wybiera jednego kandydata z jednakowym prawdopodobieństwem; pusta lista daje `null`.
 * `random` zwraca liczbę z przedziału [0, 1); wartość spoza niego (1, NaN) nie wychodzi poza listę.
 */
export function pickHomeBanner<T>(
  candidates: readonly T[],
  random: () => number = bannerRandom,
): T | null {
  if (candidates.length === 0) {
    return null;
  }

  const raw = Math.floor(random() * candidates.length);
  const index = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), candidates.length - 1) : 0;

  return candidates[index] ?? null;
}
