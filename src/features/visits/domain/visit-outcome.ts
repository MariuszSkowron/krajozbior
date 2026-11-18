// Outcome of confirming a visit on site, and the texts the person sees
// (E2; spec D-T3, R-01, R-02, D-14). The decision itself (distance against the
// radius, accuracy against 150 m) is made only by record_on_site_visit() in
// the database; this module only turns its answer into a typed value and text.

/** Frozen lists: the migration copies them into CHECK constraints (an integration test compares them). */
export const VISIT_KINDS = ["on_site", "past"] as const;
export const DATE_PRECISIONS = ["day", "month", "year", "unknown"] as const;

export type VisitOutcome =
  | Readonly<{ result: "recorded"; distanceM: number }>
  | Readonly<{ result: "out_of_range"; distanceM: number }>
  | Readonly<{ result: "inaccurate"; accuracyM: number }>
  | Readonly<{ result: "not_found" }>;

/**
 * Distance as text: "350 m" below a kilometre, otherwise kilometres with one
 * decimal and a comma ("6,2 km"); a whole number of kilometres has no decimal.
 */
export function formatDistance(distanceM: number): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) {
    throw new RangeError("A distance is a finite number of metres, 0 or more");
  }
  const metres = Math.round(distanceM);

  if (metres < 1000) {
    return `${metres} m`;
  }

  const kilometres = (Math.round(metres / 100) / 10).toFixed(1).replace(".", ",");

  return `${kilometres.replace(/,0$/, "")} km`;
}

/**
 * Turns the row of record_on_site_visit() into a typed outcome. The accuracy
 * of the reading never comes back from the database (it stores none): the
 * caller passes the value it just sent, and it is only shown in the answer.
 */
export function toVisitOutcome(
  row: Readonly<{ result: string; distance_m: number | null }>,
  accuracyM: number,
): VisitOutcome {
  switch (row.result) {
    case "recorded":
    case "out_of_range":
      if (row.distance_m === null) {
        throw new Error("The visit function returned no distance");
      }

      return { result: row.result, distanceM: row.distance_m };
    case "inaccurate":
      return { result: "inaccurate", accuracyM: Math.round(accuracyM) };
    case "not_found":
      return { result: "not_found" };
    default:
      throw new Error("The visit function returned an unknown result");
  }
}

/** The message under the "Potwierdź wizytę" button for every outcome. */
export function visitOutcomeMessage(outcome: VisitOutcome): string {
  switch (outcome.result) {
    case "recorded":
      return "Wizyta potwierdzona.";
    case "out_of_range":
      return `Jesteś ${formatDistance(outcome.distanceM)} od miejsca.`;
    case "inaccurate":
      return `Lokalizacja jest zbyt niedokładna (±${outcome.accuracyM} m). Spróbuj na zewnątrz albo zaznacz wizytę z przeszłości.`;
    case "not_found":
      return "Nie znaleziono tego miejsca.";
  }
}

/** Messages for a refusal or a failure of the geolocation of the browser (no visit is created). */
export type GeolocationProblem = "denied" | "unavailable" | "unsupported" | "timeout";

export function geolocationProblemMessage(problem: GeolocationProblem): string {
  switch (problem) {
    case "denied":
      return "Nie mamy zgody na lokalizację. Zezwól na nią w ustawieniach przeglądarki albo zaznacz wizytę z przeszłości.";
    case "unavailable":
      return "Nie udało się ustalić Twojego położenia. Spróbuj na zewnątrz albo zaznacz wizytę z przeszłości.";
    case "timeout":
      return "Ustalanie położenia trwało zbyt długo. Spróbuj ponownie.";
    case "unsupported":
      return "Ta przeglądarka nie obsługuje lokalizacji. Zaznacz wizytę z przeszłości.";
  }
}
