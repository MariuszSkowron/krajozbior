import { describe, expect, it, vi } from "vitest";

import type { ReportsDeps, ReportsRepository } from "@/features/reports/application/report-types";
import { handleDecision } from "@/features/reports/http/decision-http";

// The route of the decision: origin, body limit, mapping of the answers. Rules are tested with the
// use case and the database.
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const reportId = "33333333-3333-4333-8333-333333333333";

function setup(options: {
  actor?: typeof actor | null;
  organizationIds?: string[];
  decide?: unknown;
  limit?: { allowed: false; retryAfterSeconds: number };
}) {
  const decide = vi.fn(async () => options.decide ?? { status: "ok", version: 2 });
  const repository = {
    permittedOrganizationIds: async () => options.organizationIds ?? ["org"],
    countOpen: async () => 0,
    listQueue: async () => [],
    decide,
  } as unknown as ReportsRepository;
  const deps: ReportsDeps = {
    limiter: { reserve: async () => options.limit ?? { allowed: true } },
    withUserContext: (_who, work) => work({} as never),
    repository,
  };

  return {
    decide,
    dependencies: {
      getActor: async () => (options.actor === undefined ? actor : options.actor),
      deps: () => deps,
    },
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/curator/reports/x/decision", {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function answer(response: Response) {
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("cache-control"),
  };
}

describe("POST /api/curator/reports/{id}/decision", () => {
  it("decides and answers with the new version, never cached", async () => {
    const { dependencies, decide } = setup({});

    expect(
      await answer(
        await handleDecision(post({ action: "accept", version: 1 }), reportId, dependencies),
      ),
    ).toEqual({
      status: 200,
      body: { version: 2, status: "accepted" },
      cache: "private, no-store",
    });
    expect(decide).toHaveBeenCalledOnce();
  });

  it("refuses a foreign origin before reading anything", async () => {
    const { dependencies, decide } = setup({});
    const response = await handleDecision(
      post({ action: "accept", version: 1 }, { origin: "http://evil.example" }),
      reportId,
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(decide).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After over the write limit, and decides nothing", async () => {
    const { dependencies, decide } = setup({ limit: { allowed: false, retryAfterSeconds: 30 } });
    const response = await handleDecision(
      post({ action: "accept", version: 1 }),
      reportId,
      dependencies,
    );

    expect(response.headers.get("retry-after")).toBe("30");
    expect(await answer(response)).toMatchObject({
      status: 429,
      body: { error: "rate_limited" },
      cache: "private, no-store",
    });
    expect(decide).not.toHaveBeenCalled();
  });

  it("answers 401 for a guest", async () => {
    const { dependencies } = setup({ actor: null });

    expect(
      (await handleDecision(post({ action: "accept", version: 1 }), reportId, dependencies)).status,
    ).toBe(401);
  });

  it("answers 404 for no membership, a bad id and a report of someone else", async () => {
    const body = { action: "accept", version: 1 };

    expect(
      (await handleDecision(post(body), reportId, setup({ organizationIds: [] }).dependencies))
        .status,
    ).toBe(404);
    expect((await handleDecision(post(body), "nope", setup({}).dependencies)).status).toBe(404);
    expect(
      (
        await handleDecision(
          post(body),
          reportId,
          setup({ decide: { status: "not_found" } }).dependencies,
        )
      ).status,
    ).toBe(404);
  });

  it("answers 422 for a body that fails validation", async () => {
    const response = await handleDecision(
      post({ action: "reject", version: 1 }),
      reportId,
      setup({}).dependencies,
    );

    expect(await answer(response)).toMatchObject({ status: 422, body: { fields: ["reason"] } });
  });

  it("answers 409 with the reason, and a sentence for a stale version", async () => {
    const stale = await handleDecision(
      post({ action: "accept", version: 1 }),
      reportId,
      setup({ decide: { status: "conflict", reason: "stale_version" } }).dependencies,
    );
    const gone = await handleDecision(
      post({ action: "undo", version: 1 }),
      reportId,
      setup({ decide: { status: "conflict", reason: "author_gone" } }).dependencies,
    );

    expect(await answer(stale)).toMatchObject({
      status: 409,
      body: { reason: "stale_version", message: expect.stringContaining("Odśwież") },
    });
    expect((await answer(gone)).body).toEqual({ error: "conflict", reason: "author_gone" });
  });

  it("answers 400 for a body that is not an object, and 413 for a big one", async () => {
    const { dependencies, decide } = setup({});

    expect((await handleDecision(post("[1]"), reportId, dependencies)).status).toBe(400);
    expect((await handleDecision(post("not json"), reportId, dependencies)).status).toBe(400);
    expect(
      (
        await handleDecision(
          post({ action: "accept", version: 1 }, { "content-length": "99999" }),
          reportId,
          dependencies,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await handleDecision(
          post(JSON.stringify({ note: "a".repeat(5000) })),
          reportId,
          dependencies,
        )
      ).status,
    ).toBe(413);
    expect(decide).not.toHaveBeenCalled();
  });

  it("answers 503 without details when the database fails", async () => {
    const { dependencies } = setup({});
    const failing = {
      ...dependencies,
      deps: () => {
        throw new Error("boom: secret");
      },
    };
    const response = await handleDecision(
      post({ action: "accept", version: 1 }),
      reportId,
      failing,
    );

    expect(await answer(response)).toMatchObject({ status: 503, body: { error: "unavailable" } });
  });
});
