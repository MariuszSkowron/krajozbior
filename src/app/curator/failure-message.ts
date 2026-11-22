// What the panel tells a curator when a request to /api/curator/** fails. The
// API answers with a status and a small JSON body (src/features/catalog/http);
// this turns both into Polish text. No rule of who may do what lives here.

import {
  COLLECTION_SUMMARY_MAX_LENGTH,
  COLLECTION_TITLE_MAX_LENGTH,
} from "@/features/catalog/domain/collection";
import {
  MAX_COLLECTIONS_PER_LIST,
  MAX_PLACES_PER_COLLECTION,
} from "@/features/catalog/domain/limits";
import {
  PLACE_ACCESS_MAX_LENGTH,
  PLACE_ADDRESS_MAX_LENGTH,
  PLACE_DESCRIPTION_MAX_LENGTH,
  PLACE_NAME_MAX_LENGTH,
  VISIT_RADIUS_MAX_M,
  VISIT_RADIUS_MIN_M,
} from "@/features/catalog/domain/place";

export type Subject = "collection" | "place";

export type Failure = Readonly<{
  message: string;
  /** Names of the form fields the server refused (empty when none). */
  fields: readonly string[];
  /** The row changed under the curator: the screen offers to reload it. */
  stale: boolean;
}>;

type Body = Readonly<{ error?: unknown; reason?: unknown; fields?: unknown }>;

const FALLBACK = "Nie udało się zapisać. Spróbuj ponownie za chwilę.";

function fieldNames(body: Body): readonly string[] {
  return Array.isArray(body.fields)
    ? body.fields.filter((field): field is string => typeof field === "string")
    : [];
}

export function describeFailure(status: number, body: Body, subject: Subject): Failure {
  const failure = (message: string, fields: readonly string[] = [], stale = false): Failure => ({
    message,
    fields,
    stale,
  });

  switch (status) {
    case 400:
      return failure("Popraw zaznaczone pola i zapisz jeszcze raz.", fieldNames(body));
    case 401:
      return failure("Sesja wygasła. Zaloguj się ponownie.");
    case 403:
      return failure("Nie masz uprawnień do tej zmiany.");
    case 404:
      return failure("Nie znaleziono. Ten element mógł zostać usunięty.");
    case 413:
      return failure("Wpisane dane są zbyt duże.");
    case 429:
      return failure("Za dużo zapisów w krótkim czasie. Spróbuj za chwilę.");
    case 409:
      switch (body.reason) {
        case "stale_version":
          return failure(
            subject === "collection"
              ? "Ktoś zmienił tę kolekcję, odśwież."
              : "Ktoś zmienił to miejsce, odśwież.",
            [],
            true,
          );
        case "was_published":
          return failure(
            "Kolekcji, która była opublikowana, nie można usunąć. Wycofaj jej publikację.",
          );
        case "last_place_of_published_collection":
          return failure(
            "To ostatnie miejsce opublikowanej kolekcji. Najpierw wycofaj publikację.",
          );
        case "already_in_collection":
          return failure("To miejsce jest już w kolekcji.");
        case "too_many_places":
          return failure(
            `Kolekcja ma już ${MAX_PLACES_PER_COLLECTION} miejsc, to najwięcej. Usuń któreś, by dodać nowe.`,
          );
        case "too_many_collections":
          return failure(
            `Organizacja ma już ${MAX_COLLECTIONS_PER_LIST} kolekcji, to najwięcej. Nie da się utworzyć kolejnej.`,
          );
        default:
          return failure(FALLBACK);
      }
    case 422:
      switch (body.reason) {
        case "no_places":
          return failure("Dodaj do kolekcji co najmniej jedno miejsce, zanim ją opublikujesz.");
        case "cover_not_allowed":
          return failure(
            "To zdjęcie nie może być okładką tej kolekcji (nie jest już gotowe albo jego miejsce wyszło z kolekcji). Odśwież stronę.",
            [],
            true,
          );
        default:
          return failure("Stan kolekcji już się zmienił. Odśwież stronę.", [], true);
      }
    default:
      return failure(FALLBACK);
  }
}

// Hints shown next to a refused field: how to correct it.
export const fieldHints: Readonly<Record<string, string>> = {
  title: `Wpisz nazwę kolekcji (do ${COLLECTION_TITLE_MAX_LENGTH} znaków).`,
  summary: `Opis może mieć najwyżej ${COLLECTION_SUMMARY_MAX_LENGTH} znaków.`,
  region: "Wybierz województwo.",
  name: `Wpisz nazwę miejsca (do ${PLACE_NAME_MAX_LENGTH} znaków).`,
  description: `Opis może mieć najwyżej ${PLACE_DESCRIPTION_MAX_LENGTH} znaków.`,
  address: `Adres może mieć najwyżej ${PLACE_ADDRESS_MAX_LENGTH} znaków.`,
  accessInfo: `Informacja o dostępie może mieć najwyżej ${PLACE_ACCESS_MAX_LENGTH} znaków.`,
  accessRestriction: "Wybierz jedną z opcji z listy.",
  latitude: "Podaj szerokość geograficzną od −90 do 90, na przykład 54.0928.",
  longitude: "Podaj długość geograficzną od −180 do 180, na przykład 18.7919.",
  visitRadiusM: `Podaj promień jako liczbę całkowitą od ${VISIT_RADIUS_MIN_M} do ${VISIT_RADIUS_MAX_M} metrów.`,
};

/** Text of a number typed with a comma or a dot; anything else stays as typed. */
export function parseNumberField(text: string): number | string {
  const normalized = text.trim().replace(",", ".");

  if (normalized === "" || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return text;
  }

  return Number(normalized);
}
