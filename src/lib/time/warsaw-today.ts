// The calendar day in Poland, whatever the zone of the server. Shared by the features that count
// in days (visits, news events, the place of the day), so none imports the domain of another.

const warsawDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date (YYYY-MM-DD) in Poland. The clock is a parameter, so tests can set it. */
export function warsawToday(now: Date): string {
  return warsawDay.format(now);
}
