/** Polish plural form: one (1), few (2–4, but not 12–14), many (the rest). */
export function polishPlural<T>(count: number, one: T, few: T, many: T): T {
  const lastTwo = count % 100;
  const last = count % 10;

  if (count === 1) {
    return one;
  }

  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
}

/** "1 miejsce", "3 miejsca", "5 miejsc", "12 miejsc", "22 miejsca" (Polish plural of the number of places). */
export function formatPlaceCount(count: number): string {
  return `${count} ${polishPlural(count, "miejsce", "miejsca", "miejsc")}`;
}
