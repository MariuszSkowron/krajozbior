import { describe, expect, it, vi } from "vitest";

import type {
  InsertResult,
  ReportsDeps,
  ReportsRepository,
} from "@/features/reports/application/report-types";
import { handleSubmitReport } from "@/features/reports/http/submit-http";

// The route that sends a report: the switch comes first, then origin, body limit and the mapping of
// the answers. Rules are tested with the use case and the database.
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const placeId = "22222222-2222-4222-8222-222222222222";

function setup(
  options: {
    enabled?: boolean;
    actor?: typeof actor | null;
    result?: InsertResult;
    limit?: { allowed: false; retryAfterSeconds: number };
  } = {},
) {
  const insertReport = vi.fn(
    async () =>
      options.result ??
      ({ status: "ok", id: "report-1", organizationName: "Gmina Tczew" } as const),
  );
  const getActor = vi.fn(async () => (options.actor === undefined ? actor : options.actor));
  const deps: ReportsDeps = {
    limiter: { reserve: async () => options.limit ?? { allowed: true } },
    withUserContext: (_who, work) => work({} as never),
    repository: { insertReport } as unknown as ReportsRepository,
  };

  return {
    insertReport,
    getActor,
    dependencies: {
      enabled: () => options.enabled ?? true,
      getActor,
      deps: () => deps,
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/places/${placeId}/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function answer(response: Response) {
  return { status: response.status, body: await response.json() };
}

const valid = { category: "closed", message: "Brama zamknięta" };

describe("POST /api/places/{placeId}/reports", () => {
  it("answers 404 first when the switch is off: no session, origin or body is read, nothing is written", async () => {
    const { dependencies, getActor, insertReport } = setup({ enabled: false });
    const response = await handleSubmitReport(
      post(valid, { origin: "http://evil.example" }),
      placeId,
      dependencies,
    );

    expect(await answer(response)).toEqual({ status: 404, body: { error: "not_found" } });
    expect(getActor).not.toHaveBeenCalled();
    expect(insertReport).not.toHaveBeenCalled();
  });

  it("sends the report and answers 201 with the organization, never cached", async () => {
    const { dependencies, insertReport } = setup();
    const response = await handleSubmitReport(post(valid), placeId, dependencies);

    expect(await answer(response)).toEqual({
      status: 201,
      body: { id: "report-1", organizationName: "Gmina Tczew" },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(insertReport).toHaveBeenCalledOnce();
  });

  it("refuses a foreign origin before reading anything", async () => {
    const { dependencies, getActor } = setup();
    const response = await handleSubmitReport(
      post(valid, { origin: "http://evil.example" }),
      placeId,
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(getActor).not.toHaveBeenCalled();
  });

  it("answers 413 to a body over 8 KB, also without a Content-Length", async () => {
    const { dependencies, insertReport } = setup();
    const huge = JSON.stringify({ category: "closed", message: "a".repeat(9 * 1024) });
    const response = await handleSubmitReport(
      post(huge, { "content-length": "10" }),
      placeId,
      dependencies,
    );

    expect(response.status).toBe(413);
    expect(insertReport).not.toHaveBeenCalled();
  });

  it("answers 401 to a guest", async () => {
    const { dependencies, insertReport } = setup({ actor: null });

    expect(await answer(await handleSubmitReport(post(valid), placeId, dependencies))).toEqual({
      status: 401,
      body: { error: "unauthenticated" },
    });
    expect(insertReport).not.toHaveBeenCalled();
  });

  it("answers 422 to a body that is not an object or has bad fields", async () => {
    const { dependencies } = setup();

    expect(
      await answer(await handleSubmitReport(post({ category: "other" }), placeId, dependencies)),
    ).toEqual({ status: 422, body: { error: "invalid", fields: ["message"] } });
    expect((await handleSubmitReport(post("[1]"), placeId, dependencies)).status).toBe(422);
    expect((await handleSubmitReport(post("not json"), placeId, dependencies)).status).toBe(422);
  });

  it("answers 404 for a place that is not public, 403 for the own organization", async () => {
    expect(
      (
        await handleSubmitReport(
          post(valid),
          placeId,
          setup({ result: { status: "not_found" } }).dependencies,
        )
      ).status,
    ).toBe(404);
    expect(
      await answer(
        await handleSubmitReport(
          post(valid),
          placeId,
          setup({ result: { status: "own_organization" } }).dependencies,
        ),
      ),
    ).toEqual({ status: 403, body: { error: "own_organization" } });
  });

  it("answers 409 to a duplicate and to a full queue of the place, with a sentence for the person", async () => {
    expect(
      await answer(
        await handleSubmitReport(
          post(valid),
          placeId,
          setup({ result: { status: "duplicate_open" } }).dependencies,
        ),
      ),
    ).toEqual({
      status: 409,
      body: {
        error: "duplicate_open",
        message: "Masz już otwarte zgłoszenie tego rodzaju dla tego miejsca.",
      },
    });
    expect(
      await answer(
        await handleSubmitReport(
          post(valid),
          placeId,
          setup({ result: { status: "place_queue_full" } }).dependencies,
        ),
      ),
    ).toEqual({
      status: 409,
      body: {
        error: "place_queue_full",
        message:
          "To miejsce ma już wiele zgłoszeń czekających na kuratora. Kurator się nimi zajmuje.",
      },
    });
  });

  it("answers 429 to the daily and the open limit, and with Retry-After to a series", async () => {
    const daily = await handleSubmitReport(
      post(valid),
      placeId,
      setup({ result: { status: "daily_limit" } }).dependencies,
    );

    expect(await answer(daily)).toEqual({
      status: 429,
      body: { error: "rate_limited", message: "Wysłano już dużo zgłoszeń. Spróbuj jutro." },
    });
    expect(daily.headers.get("retry-after")).toBeNull();

    const open = await handleSubmitReport(
      post(valid),
      placeId,
      setup({ result: { status: "open_limit" } }).dependencies,
    );

    expect(open.status).toBe(429);
    expect((await open.json()).message).toContain("50 zgłoszeń czekających na kuratorów");

    const burst = await handleSubmitReport(
      post(valid),
      placeId,
      setup({ limit: { allowed: false, retryAfterSeconds: 30 } }).dependencies,
    );

    expect(burst.status).toBe(429);
    expect(burst.headers.get("retry-after")).toBe("30");
  });

  it("answers 503 and does not echo the failure", async () => {
    const { dependencies, insertReport } = setup();

    insertReport.mockRejectedValueOnce(new Error("secret detail"));

    const response = await handleSubmitReport(post(valid), placeId, dependencies);

    expect(await answer(response)).toEqual({ status: 503, body: { error: "unavailable" } });
  });
});
