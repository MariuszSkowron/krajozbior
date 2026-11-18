import { describeFailure, type Failure, type Subject } from "./failure-message";

// One request of the panel to /api/curator/**. The browser adds the Origin
// header of the page itself, which the routes check; the session cookie is
// sent automatically. A network failure is a failure like any other.

export type ApiResult<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: Failure }>;

export async function callApi<T = null>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  subject: Subject,
  body?: Readonly<Record<string, unknown>>,
): Promise<ApiResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { ok: false, failure: describeFailure(0, {}, subject) };
  }

  let payload: unknown = null;

  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }

  if (response.ok) {
    return { ok: true, value: payload as T };
  }

  const record =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};

  return { ok: false, failure: describeFailure(response.status, record, subject) };
}
