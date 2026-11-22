const dayAndMonth = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Warsaw",
});

const yearOnly = new Intl.DateTimeFormat("pl-PL", {
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

/**
 * A day for a list ("08.11"), in Polish time. The year is added ("08.11.2025")
 * only when it differs from the year of `now`, so a date from another year is
 * never read as a date from this one.
 */
export function formatSavedDate(savedAt: Date, now: Date = new Date()): string {
  if (Number.isNaN(savedAt.getTime())) {
    throw new RangeError("A save date must be a valid date");
  }

  const year = yearOnly.format(savedAt);
  const text = dayAndMonth.format(savedAt);

  return year === yearOnly.format(now) ? text : `${text}.${year}`;
}
