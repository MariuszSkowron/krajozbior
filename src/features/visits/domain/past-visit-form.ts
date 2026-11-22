import type { DatePrecision } from "./past-visit-request";

// The form of a visit from the past (place page and collection page share it):
// what the person typed, the body for POST /api/me/visits/past, and the texts of
// the answers. Whether a date is allowed (not in the future, not before 1900) is
// decided by the server; the form only checks that the chosen fields are filled.

export type PastVisitDateForm = Readonly<{
  precision: DatePrecision;
  /** From `<input type="date">`: YYYY-MM-DD or "". */
  day: string;
  /** "01".."12" or "". */
  month: string;
  /** The year that goes with the month. */
  monthYear: string;
  /** The year of the "year" precision. */
  year: string;
}>;

export const EMPTY_PAST_VISIT_DATE: PastVisitDateForm = {
  precision: "unknown",
  day: "",
  month: "",
  monthYear: "",
  year: "",
};

export type PastVisitDateBody = Readonly<{ precision: DatePrecision; value?: string }>;

const YEAR = /^\d{4}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^(0[1-9]|1[0-2])$/;

export const INCOMPLETE_DATE_MESSAGE = "Uzupełnij datę albo wybierz „Nie pamiętam”.";

/**
 * The `date` of the request body, built only from the field of the chosen
 * precision (the other fields are ignored), or null when that field is empty or
 * not in the shape the field gives.
 */
export function toPastVisitDateBody(form: PastVisitDateForm): PastVisitDateBody | null {
  switch (form.precision) {
    case "unknown":
      return { precision: "unknown" };
    case "day":
      return DAY.test(form.day) ? { precision: "day", value: form.day } : null;
    case "month":
      return MONTH.test(form.month) && YEAR.test(form.monthYear)
        ? { precision: "month", value: `${form.monthYear}-${form.month}` }
        : null;
    case "year":
      return YEAR.test(form.year) ? { precision: "year", value: form.year } : null;
  }
}

const FAILURES: Record<number, (many: boolean) => string> = {
  400: () => "Sprawdź datę: nie może być z przyszłości ani sprzed roku 1900.",
  401: () => "Zaloguj się, żeby zapisać wizytę.",
  404: (many) =>
    many
      ? "Któreś z zaznaczonych miejsc nie jest już dostępne. Odśwież stronę."
      : "To miejsce nie jest już dostępne.",
  429: () => "Za dużo prób. Spróbuj za chwilę.",
};

/** The message for a refused or failed save (the status is the answer of the route). */
export function pastVisitFailureMessage(status: number, many: boolean): string {
  return (
    FAILURES[status]?.(many) ?? "Nie udało się zapisać wizyty z przeszłości. Spróbuj ponownie."
  );
}

/** The message for a refused removal of a visit from the past. */
export function pastVisitRemovalFailureMessage(status: number): string {
  if (status === 401) {
    return "Zaloguj się, żeby usunąć wizytę.";
  }

  return status === 429
    ? FAILURES[status]!(false)
    : "Nie udało się usunąć wizyty z przeszłości. Spróbuj ponownie.";
}

function plural(n: number, one: string, few: string, many: string): string {
  const lastTwo = n % 100;
  const last = n % 10;

  if (n === 1) {
    return one;
  }

  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
}

/** What was saved and what was skipped because the explorer already had a visit there. */
export function pastVisitSavedMessage(recorded: number, alreadyVisited: number): string {
  if (recorded === 0) {
    return alreadyVisited === 1
      ? "Masz już zapisaną wizytę w tym miejscu, więc nic nie zmieniono."
      : "Masz już zapisane wizyty w tych miejscach, więc nic nie zmieniono.";
  }

  const saved = `Zapisano ${recorded} ${plural(recorded, "wizytę", "wizyty", "wizyt")} z przeszłości.`;

  return alreadyVisited === 0
    ? saved
    : `${saved} Pominięto ${alreadyVisited} ${plural(alreadyVisited, "miejsce", "miejsca", "miejsc")} z wcześniej zapisaną wizytą.`;
}

/**
 * The count of chosen places, read out when it changes. At the limit it says why
 * the other places cannot be chosen any more.
 */
export function pickedCountMessage(count: number, max: number): string {
  return count >= max
    ? `Wybrane: ${count}. Zaznaczono ${max} miejsc — to najwięcej naraz.`
    : `Wybrane: ${count}.`;
}

/** Today of the device clock as YYYY-MM-DD (not the UTC day), for the `max` of a date field. */
export function localDateIso(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

/** The note on the place page: "Z przeszłości · marzec 2019". */
export function pastVisitBadgeText(dateText: string): string {
  return `Z przeszłości · ${dateText}`;
}
