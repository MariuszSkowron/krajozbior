import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import {
  deleteMyPastVisit,
  getMyVisitOfPlace,
  listMyVisitKindsOfCollection,
  markPastVisits,
} from "@/features/visits/application/mark-past-visits";
import type { VisitDeps } from "@/features/visits/application/visit-types";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-18T11:00:00Z");
const body = { placeIds: [A, B], date: { precision: "month", value: "2019-03" } };

function makeDeps(counts = { visible: 2, recorded: 2 }, allowed = true) {
  const order: string[] = [];
  const reserve = vi.fn(async () => {
    order.push("limit");

    return allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 9 };
  });
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) => {
    order.push("context");

    return work({} as never);
  });
  const repository = {
    markPastVisits: vi.fn(async () => counts),
    deleteMyPastVisits: vi.fn(async () => 1),
    getMyVisitOfPlace: vi.fn(async () => ({ onSite: false, past: null })),
    listMyVisitKindsOfCollection: vi.fn(async () => [{ placeId: A, kind: "past" as const }]),
  };

  return {
    deps: { withUserContext, limiter: { reserve }, repository } as unknown as VisitDeps,
    order,
    reserve,
    withUserContext,
    repository,
  };
}

describe("markPastVisits", () => {
  it("records the batch with the normalised date and counts the places that already had a visit", async () => {
    const { deps, repository, reserve } = makeDeps({ visible: 2, recorded: 1 });

    expect(await markPastVisits(actor, body, deps, NOW)).toEqual({
      status: "ok",
      value: { recorded: 1, alreadyVisited: 1 },
    });
    expect(repository.markPastVisits).toHaveBeenCalledWith(expect.anything(), [A, B], {
      visitedOn: "2019-03-01",
      precision: "month",
    });
    expect(reserve).toHaveBeenCalledWith("visit_past", actor.id, { limit: 30, windowSeconds: 600 });
  });

  it("uses the current time when no clock is passed", async () => {
    const { deps } = makeDeps();

    expect(
      (await markPastVisits(actor, { placeIds: [A, B], date: { precision: "unknown" } }, deps))
        .status,
    ).toBe("ok");
  });

  it("answers not_found for the whole batch when a place is not visible", async () => {
    const { deps } = makeDeps({ visible: 1, recorded: 0 });

    expect(await markPastVisits(actor, body, deps, NOW)).toEqual({ status: "not_found" });
  });

  it("answers 401 to a guest before the limit, the body or the database", async () => {
    const { deps, reserve, withUserContext } = makeDeps();

    expect(await markPastVisits(null, "garbage", deps, NOW)).toEqual({
      status: "unauthenticated",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("limits before validating, and validates before the database", async () => {
    const limited = makeDeps(undefined, false);

    expect(await markPastVisits(actor, "garbage", limited.deps, NOW)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(limited.withUserContext).not.toHaveBeenCalled();

    const invalid = makeDeps();

    expect(await markPastVisits(actor, { placeIds: [] }, invalid.deps, NOW)).toEqual({
      status: "invalid",
    });
    expect(invalid.order).toEqual(["limit"]);
  });
});

describe("deleteMyPastVisit", () => {
  it("removes the own past visits of the place", async () => {
    const { deps, repository } = makeDeps();

    expect(await deleteMyPastVisit(actor, A, deps)).toEqual({
      status: "ok",
      value: { removed: 1 },
    });
    expect(repository.deleteMyPastVisits).toHaveBeenCalledWith(expect.anything(), A);
  });

  it("answers 401 to a guest, 429 over the limit and not_found for a malformed id", async () => {
    const guest = makeDeps();

    expect(await deleteMyPastVisit(null, A, guest.deps)).toEqual({ status: "unauthenticated" });
    expect(guest.reserve).not.toHaveBeenCalled();
    expect(await deleteMyPastVisit(actor, A, makeDeps(undefined, false).deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });

    const { deps, withUserContext } = makeDeps();

    expect(await deleteMyPastVisit(actor, "nope", deps)).toEqual({ status: "not_found" });
    expect(withUserContext).not.toHaveBeenCalled();
  });
});

describe("getMyVisitOfPlace and listMyVisitKindsOfCollection", () => {
  it("read the kinds for the signed-in explorer only", async () => {
    const { deps } = makeDeps();

    expect(await getMyVisitOfPlace(actor, A, deps)).toEqual({
      status: "ok",
      value: { onSite: false, past: null },
    });
    expect(await listMyVisitKindsOfCollection(actor, B, deps)).toEqual({
      status: "ok",
      value: [{ placeId: A, kind: "past" }],
    });
  });

  it("answer 401 to a guest and not_found for a malformed id", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await getMyVisitOfPlace(null, A, deps)).toEqual({ status: "unauthenticated" });
    expect(await listMyVisitKindsOfCollection(null, A, deps)).toEqual({
      status: "unauthenticated",
    });
    expect(await getMyVisitOfPlace(actor, "nope", deps)).toEqual({ status: "not_found" });
    expect(await listMyVisitKindsOfCollection(actor, "nope", deps)).toEqual({
      status: "not_found",
    });
    expect(withUserContext).not.toHaveBeenCalled();
  });
});
