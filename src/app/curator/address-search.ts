import { GEOCODE_QUERY_MIN_LENGTH, type GeocodeResult } from "@/features/catalog/domain/geocode";

// One request of the place editor to /api/curator/geocode (address search, K-2). The answer is
// either the places found (an empty list means "nothing found") or a sentence for the curator.

export type AddressSearchResult =
  | Readonly<{ ok: true; results: readonly GeocodeResult[] }>
  | Readonly<{ ok: false; message: string }>;

export const SEARCH_UNAVAILABLE =
  "Wyszukiwanie adresu jest teraz niedostępne. Ustaw pinezkę na mapie albo wpisz współrzędne.";

export function describeSearchFailure(status: number): string {
  switch (status) {
    case 400:
      return `Wpisz co najmniej ${GEOCODE_QUERY_MIN_LENGTH} znaki adresu.`;
    case 401:
      return "Zaloguj się ponownie.";
    case 403:
      return "Nie masz uprawnień do wyszukiwania adresu.";
    case 429:
      return "Za dużo wyszukiwań w krótkim czasie. Spróbuj za chwilę albo ustaw pinezkę na mapie.";
    default:
      return SEARCH_UNAVAILABLE;
  }
}

export async function searchAddress(query: string): Promise<AddressSearchResult> {
  let response: Response;

  try {
    response = await fetch("/api/curator/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: SEARCH_UNAVAILABLE };
  }

  if (!response.ok) {
    return { ok: false, message: describeSearchFailure(response.status) };
  }

  try {
    const payload = (await response.json()) as { results?: unknown };

    return {
      ok: true,
      results: Array.isArray(payload.results) ? (payload.results as GeocodeResult[]) : [],
    };
  } catch {
    return { ok: false, message: SEARCH_UNAVAILABLE };
  }
}
