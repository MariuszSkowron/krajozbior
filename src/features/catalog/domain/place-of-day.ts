// „Miejsce dnia” na Starcie: jeden wybór na dzień dla wszystkich. Czyste funkcje, bez odczytów.
// Dzień to dzień kalendarzowy w Polsce (`warsawToday`), więc wynik nie zależy od strefy serwera
// i nie zmienia się przez całą dobę.

/** Okno „Nowych kolekcji”: kolekcje opublikowane w ostatnich 30 dniach. */
export const NEW_COLLECTIONS_DAYS = 30;
/** Najwyżej tyle kart w „Nowych kolekcjach”. */
export const NEW_COLLECTIONS_LIMIT = 3;

/**
 * Numer miejsca dnia wśród `count` kandydatów (0..count-1): ten sam dla tego samego dnia
 * (`YYYY-MM-DD`) i liczby kandydatów. Skrót FNV-1a z daty rozkłada wybór równomiernie, więc
 * kolejne dni nie idą po kolei listy. Przy braku kandydatów zwraca `null`.
 */
export function placeOfDayIndex(dayKey: string, count: number): number | null {
  if (count <= 0) {
    return null;
  }

  let hash = 0x811c9dc5;

  for (const char of dayKey) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash % count;
}

/** Początek okna „Nowych kolekcji” liczony od `now` (dni po 24 godziny, wystarcza do listy). */
export function newCollectionsSince(now: Date): Date {
  return new Date(now.getTime() - NEW_COLLECTIONS_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Pierwsze zdanie opisu (do kropki, wykrzyknika lub pytajnika), a gdy go nie widać albo jest
 * dłuższe niż `max` znaków, początek obcięty na granicy słowa z wielokropkiem.
 */
export function firstSentence(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = flat.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? flat : flat.slice(0, end + 1);

  if (sentence.length <= max) {
    return sentence;
  }

  const cut = sentence.slice(0, max);
  const space = cut.lastIndexOf(" ");

  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, "")}…`;
}
