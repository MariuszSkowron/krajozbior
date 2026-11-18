/** "1 miejsce", "3 miejsca", "5 miejsc", "12 miejsc", "22 miejsca" (Polish plural of the number of places). */
export function formatPlaceCount(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;

  if (count === 1) {
    return "1 miejsce";
  }

  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) {
    return `${count} miejsca`;
  }

  return `${count} miejsc`;
}
