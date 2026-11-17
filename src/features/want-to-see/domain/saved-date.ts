const formatter = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Warsaw",
});

/** The day a place was saved, as text for the list ("18 listopada 2026"), in Polish time. */
export function formatSavedDate(savedAt: Date): string {
  if (Number.isNaN(savedAt.getTime())) {
    throw new RangeError("A save date must be a valid date");
  }

  return formatter.format(savedAt);
}
