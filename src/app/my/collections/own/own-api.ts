import { type Failure } from "@/app/curator/failure-message";

// One request of the screens of own collections to /api/me/own-collections/**. The browser adds
// the Origin header of the page, which the routes check; the session cookie goes automatically. A
// network failure is a failure like any other. No rule of who may do what lives here.

export type OwnApiResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: Failure }>;

const FALLBACK = "Nie udało się zapisać. Spróbuj ponownie za chwilę.";

type Body = Readonly<{ error?: unknown; reason?: unknown; fields?: unknown; message?: unknown }>;

export function describeOwnFailure(status: number, body: Body): Failure {
  const fields = Array.isArray(body.fields)
    ? body.fields.filter((field): field is string => typeof field === "string")
    : [];
  const failure = (message: string, stale = false): Failure => ({
    message,
    fields: status === 400 ? fields : [],
    stale,
  });

  switch (status) {
    case 400:
      return failure("Popraw zaznaczone pola i zapisz jeszcze raz.");
    case 401:
      return failure("Sesja wygasła. Zaloguj się ponownie.");
    case 404:
      return failure("Nie znaleziono. Ta kolekcja albo miejsce mogło zostać usunięte.");
    case 413:
      return failure("Wpisane dane są zbyt duże.");
    case 429:
      return failure("Za dużo zapisów w krótkim czasie. Spróbuj za chwilę.");
    case 409:
      // The server words the limits itself (Polish, with the numbers).
      return failure(
        typeof body.message === "string" ? body.message : FALLBACK,
        body.reason === "stale_version",
      );
    default:
      return failure(FALLBACK);
  }
}

export async function callOwnApi<T = null>(
  method: "POST" | "PUT" | "DELETE",
  url: string,
  body?: Readonly<Record<string, unknown>>,
): Promise<OwnApiResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, failure: describeOwnFailure(0, {}) };
  }

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (response.ok) {
    return { ok: true, value: payload as T };
  }

  const record =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};

  return { ok: false, failure: describeOwnFailure(response.status, record) };
}
