import { describe, expect, it, vi } from "vitest";

import {
  countOpenReports,
  decideReport,
  getReportQueue,
} from "@/features/reports/application/curator-reports";
import type {
  DecisionResult,
  ReportsDeps,
  ReportsRepository,
} from "@/features/reports/application/report-types";

// Roles and answers of the use cases of the queue; the database (functions, policies) has its own
// integration test (`place-reports-access.test.ts`).
const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" as const };
const organizationId = "22222222-2222-4222-8222-222222222222";
const reportId = "33333333-3333-4333-8333-333333333333";

function setup(options: { organizationIds?: string[]; decision?: DecisionResult } = {}) {
  const repository = {
    permittedOrganizationIds: vi.fn(async () => options.organizationIds ?? [organizationId]),
    countOpen: vi.fn(async () => 7),
    listQueue: vi.fn(async () => []),
    decide: vi.fn(async () => options.decision ?? ({ status: "ok", version: 2 } as const)),
  } satisfies ReportsRepository;
  const deps: ReportsDeps = {
    withUserContext: (_who, work) => work({} as never),
    repository,
  };

  return { deps, repository };
}

describe("countOpenReports", () => {
  it("answers unauthenticated for a guest, before anything is read", async () => {
    const { deps, repository } = setup();

    expect(await countOpenReports(null, organizationId, deps)).toEqual({
      status: "unauthenticated",
    });
    expect(repository.permittedOrganizationIds).not.toHaveBeenCalled();
  });

  it("answers forbidden for an account without a membership", async () => {
    const { deps, repository } = setup({ organizationIds: [] });

    expect(await countOpenReports(actor, organizationId, deps)).toEqual({ status: "forbidden" });
    expect(repository.countOpen).not.toHaveBeenCalled();
  });

  it("answers not_found for an organization that is not the actor's or not an id", async () => {
    const { deps, repository } = setup();

    expect(await countOpenReports(actor, "44444444-4444-4444-8444-444444444444", deps)).toEqual({
      status: "not_found",
    });
    expect(await countOpenReports(actor, "nope", deps)).toEqual({ status: "not_found" });
    expect(repository.countOpen).not.toHaveBeenCalled();
  });

  it("counts for an organization of the actor", async () => {
    const { deps, repository } = setup();

    expect(await countOpenReports(actor, organizationId, deps)).toEqual({
      status: "ok",
      value: 7,
    });
    expect(repository.countOpen).toHaveBeenCalledWith(expect.anything(), organizationId);
  });
});

describe("getReportQueue", () => {
  it("returns the list with the count of all open reports", async () => {
    const { deps, repository } = setup();

    expect(await getReportQueue(actor, organizationId, "decided", deps)).toEqual({
      status: "ok",
      value: { state: "decided", items: [], openTotal: 7 },
    });
    expect(repository.listQueue).toHaveBeenCalledWith(expect.anything(), organizationId, "decided");
  });

  it("refuses a guest and a foreign organization", async () => {
    const { deps } = setup();

    expect(await getReportQueue(null, organizationId, "open", deps)).toEqual({
      status: "unauthenticated",
    });
    expect(
      await getReportQueue(actor, "44444444-4444-4444-8444-444444444444", "open", deps),
    ).toEqual({ status: "not_found" });
  });
});

describe("decideReport", () => {
  const accept = { action: "accept", version: 1 };

  it("answers unauthenticated for a guest", async () => {
    const { deps, repository } = setup();

    expect(await decideReport(null, reportId, accept, deps)).toEqual({ status: "unauthenticated" });
    expect(repository.decide).not.toHaveBeenCalled();
  });

  it("answers not_found for a path that is no id, and invalid for a bad body", async () => {
    const { deps, repository } = setup();

    expect(await decideReport(actor, "nope", accept, deps)).toEqual({ status: "not_found" });
    expect(await decideReport(actor, reportId, { action: "reject", version: 1 }, deps)).toEqual({
      status: "invalid",
      errors: ["reason"],
    });
    expect(repository.decide).not.toHaveBeenCalled();
  });

  it("answers forbidden for an account without a membership, without touching a report", async () => {
    const { deps, repository } = setup({ organizationIds: [] });

    expect(await decideReport(actor, reportId, accept, deps)).toEqual({ status: "forbidden" });
    expect(repository.decide).not.toHaveBeenCalled();
  });

  it("maps the three decisions to the state they leave", async () => {
    const { deps, repository } = setup();

    expect(await decideReport(actor, reportId, accept, deps)).toEqual({
      status: "ok",
      value: { version: 2, status: "accepted" },
    });
    expect(
      await decideReport(actor, reportId, { action: "reject", reason: "abuse", version: 1 }, deps),
    ).toEqual({ status: "ok", value: { version: 2, status: "rejected" } });
    expect(await decideReport(actor, reportId, { action: "undo", version: 3 }, deps)).toEqual({
      status: "ok",
      value: { version: 2, status: "open" },
    });
    expect(repository.decide).toHaveBeenLastCalledWith(expect.anything(), {
      reportId,
      action: "undo",
      reason: null,
      note: null,
      version: 3,
    });
  });

  it("passes the refusals of the database through", async () => {
    for (const reason of ["stale_version", "author_gone", "own_report", "invalid_state"] as const) {
      const { deps } = setup({ decision: { status: "conflict", reason } });

      expect(await decideReport(actor, reportId, accept, deps)).toEqual({
        status: "conflict",
        reason,
      });
    }

    expect(
      await decideReport(
        actor,
        reportId,
        accept,
        setup({ decision: { status: "not_found" } }).deps,
      ),
    ).toEqual({ status: "not_found" });
    expect(
      await decideReport(actor, reportId, accept, setup({ decision: { status: "invalid" } }).deps),
    ).toEqual({ status: "invalid", errors: ["action"] });
  });
});
