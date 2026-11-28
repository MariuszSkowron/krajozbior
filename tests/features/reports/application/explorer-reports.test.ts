import { describe, expect, it, vi } from "vitest";

import { listMyReports, submitPlaceReport } from "@/features/reports/application/explorer-reports";
import type {
  InsertResult,
  ReportsDeps,
  ReportsRepository,
} from "@/features/reports/application/report-types";
import { REPORT_ACTION, reportSubmitLimit } from "@/features/reports/domain/limits";

// Roles and answers of the use cases of the explorer; the database (limits, policies) has its own
// integration test (`place-reports-limits.test.ts`).
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const placeId = "22222222-2222-4222-8222-222222222222";

function setup(
  options: {
    result?: InsertResult;
    limit?: { allowed: false; retryAfterSeconds: number };
  } = {},
) {
  const reserve = vi.fn(async () => options.limit ?? { allowed: true as const });
  const repository = {
    permittedOrganizationIds: vi.fn(),
    countOpen: vi.fn(),
    listQueue: vi.fn(),
    decide: vi.fn(),
    insertReport: vi.fn(
      async () =>
        options.result ??
        ({ status: "ok", id: "report-1", organizationName: "Gmina Tczew" } as const),
    ),
    listMine: vi.fn(async () => []),
  } satisfies ReportsRepository;
  const deps: ReportsDeps = {
    limiter: { reserve },
    withUserContext: (_who, work) => work({} as never),
    repository,
  };

  return { deps, repository, reserve };
}

describe("submitPlaceReport", () => {
  it("answers unauthenticated for a guest, before anything is counted or written", async () => {
    const { deps, repository, reserve } = setup();

    expect(await submitPlaceReport(null, placeId, { category: "closed" }, deps)).toEqual({
      status: "unauthenticated",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(repository.insertReport).not.toHaveBeenCalled();
  });

  it("sends the report with the place of the address and the validated body, never an owner", async () => {
    const { deps, repository, reserve } = setup();

    expect(
      await submitPlaceReport(
        actor,
        placeId,
        { category: "closed", message: " Brama zamknięta ", userId: "x", authorId: "y" },
        deps,
      ),
    ).toEqual({ status: "ok", value: { id: "report-1", organizationName: "Gmina Tczew" } });
    expect(reserve).toHaveBeenCalledWith(REPORT_ACTION, actor.id, reportSubmitLimit);
    expect(repository.insertReport).toHaveBeenCalledWith(
      {},
      { placeId, category: "closed", message: "Brama zamknięta" },
    );
  });

  it("answers rate_limited with Retry-After over the series limit, and writes nothing", async () => {
    const { deps, repository } = setup({ limit: { allowed: false, retryAfterSeconds: 42 } });

    expect(await submitPlaceReport(actor, placeId, { category: "closed" }, deps)).toEqual({
      status: "rate_limited",
      reason: "burst",
      retryAfterSeconds: 42,
    });
    expect(repository.insertReport).not.toHaveBeenCalled();
  });

  it("answers not_found for an address that is not an id, without asking the database", async () => {
    const { deps, repository } = setup();

    expect(await submitPlaceReport(actor, "nope", { category: "closed" }, deps)).toEqual({
      status: "not_found",
    });
    expect(repository.insertReport).not.toHaveBeenCalled();
  });

  it("answers invalid with the fields of a bad body", async () => {
    const { deps, repository } = setup();

    expect(await submitPlaceReport(actor, placeId, { category: "other" }, deps)).toEqual({
      status: "invalid",
      errors: ["message"],
    });
    expect(repository.insertReport).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "daily_limit" }, { status: "rate_limited", reason: "daily" }],
    [{ status: "open_limit" }, { status: "rate_limited", reason: "open" }],
    [{ status: "place_queue_full" }, { status: "place_queue_full" }],
    [{ status: "duplicate_open" }, { status: "duplicate_open" }],
    [{ status: "own_organization" }, { status: "own_organization" }],
    [{ status: "not_found" }, { status: "not_found" }],
  ] as const)("passes the refusal of the database on: %j", async (result, expected) => {
    const { deps } = setup({ result });

    expect(await submitPlaceReport(actor, placeId, { category: "closed" }, deps)).toEqual(expected);
  });
});

describe("listMyReports", () => {
  it("answers unauthenticated for a guest, without reading", async () => {
    const { deps, repository } = setup();

    expect(await listMyReports(null, deps)).toEqual({ status: "unauthenticated" });
    expect(repository.listMine).not.toHaveBeenCalled();
  });

  it("lists the reports of the actor", async () => {
    const { deps, repository } = setup();

    expect(await listMyReports(actor, deps)).toEqual({ status: "ok", items: [] });
    expect(repository.listMine).toHaveBeenCalledOnce();
  });
});
