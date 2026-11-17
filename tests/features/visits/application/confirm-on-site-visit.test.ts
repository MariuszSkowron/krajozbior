import { describe, expect, it, vi } from "vitest";

import type { Actor } from "@/features/identity/domain/actor";
import {
  confirmOnSiteVisit,
  hasVisitedPlace,
} from "@/features/visits/application/confirm-on-site-visit";
import type { VisitDeps, VisitFunctionRow } from "@/features/visits/application/visit-types";

const actor: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const PLACE = "22222222-2222-4222-8222-222222222222";
const COLLECTION = "33333333-3333-4333-8333-333333333333";
const OTHER_COLLECTION = "33333333-3333-4333-8333-333333333334";
const OTHER_PLACE = "44444444-4444-4444-8444-444444444444";
const body = {
  latitude: 54.0,
  longitude: 18.0,
  accuracy: 12.4,
  clientVisitId: "55555555-5555-4555-8555-555555555555",
};

function makeDeps(row: VisitFunctionRow | Error, allowed = true, visited = false) {
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work({} as never),
  );
  const reserve = vi.fn(async () =>
    allowed ? { allowed: true as const } : { allowed: false as const, retryAfterSeconds: 9 },
  );
  const recordOnSiteVisit = vi.fn(async () => {
    if (row instanceof Error) {
      throw row;
    }

    return row;
  });
  const deps = {
    withUserContext,
    limiter: { reserve },
    repository: { recordOnSiteVisit, hasVisitedPlace: async () => visited },
    album: {
      listSavedCollections: async () => [
        { id: COLLECTION, slug: "a", title: "A", region: "pomorskie" },
        { id: OTHER_COLLECTION, slug: "b", title: "B", region: "pomorskie" },
      ],
      listSavedCollectionPlaces: async () => [
        { collectionId: COLLECTION, placeId: PLACE },
        { collectionId: COLLECTION, placeId: OTHER_PLACE },
        { collectionId: OTHER_COLLECTION, placeId: OTHER_PLACE },
      ],
      listVisitedPlaceIds: async () => [PLACE],
    },
  } as unknown as VisitDeps;

  return { deps, withUserContext, reserve, recordOnSiteVisit };
}

describe("confirmOnSiteVisit", () => {
  it("records the visit and returns the progress of the saved collections with the place", async () => {
    const { deps, recordOnSiteVisit, withUserContext } = makeDeps({
      result: "recorded",
      distance_m: 31,
    });
    const outcome = await confirmOnSiteVisit(actor, PLACE, body, deps);

    expect(outcome).toEqual({
      status: "ok",
      value: {
        result: "recorded",
        collections: [
          { slug: "a", title: "A", progress: { kind: "progress", visited: 1, total: 2 } },
        ],
      },
    });
    expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
    expect(recordOnSiteVisit).toHaveBeenCalledWith(expect.anything(), PLACE, {
      latitude: 54,
      longitude: 18,
      accuracyM: 12.4,
      clientVisitId: body.clientVisitId,
    });
    // No distance and no position in the answer of a recorded visit.
    expect(JSON.stringify(outcome)).not.toContain("distanceM");
  });

  it("tells the distance when the person is too far, and nothing else", async () => {
    const { deps } = makeDeps({ result: "out_of_range", distance_m: 6200 });

    expect(await confirmOnSiteVisit(actor, PLACE, body, deps)).toEqual({
      status: "ok",
      value: { result: "out_of_range", distanceM: 6200 },
    });
  });

  it("tells the rounded accuracy when the reading is too inaccurate", async () => {
    const { deps } = makeDeps({ result: "inaccurate", distance_m: null });

    expect(await confirmOnSiteVisit(actor, PLACE, { ...body, accuracy: 480.6 }, deps)).toEqual({
      status: "ok",
      value: { result: "inaccurate", accuracyM: 481 },
    });
  });

  it("answers not_found for a place the database does not show, and for a malformed id", async () => {
    const { deps, recordOnSiteVisit } = makeDeps({ result: "not_found", distance_m: null });

    expect(await confirmOnSiteVisit(actor, PLACE, body, deps)).toEqual({ status: "not_found" });
    expect(await confirmOnSiteVisit(actor, "nope", body, deps)).toEqual({ status: "not_found" });
    expect(recordOnSiteVisit).toHaveBeenCalledTimes(1);
  });

  it("refuses a guest before the limiter and the database", async () => {
    const { deps, reserve, withUserContext } = makeDeps({ result: "recorded", distance_m: 1 });

    expect(await confirmOnSiteVisit(null, PLACE, body, deps)).toEqual({
      status: "unauthenticated",
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("answers rate_limited over the limit and records nothing", async () => {
    const { deps, recordOnSiteVisit, reserve } = makeDeps(
      { result: "recorded", distance_m: 1 },
      false,
    );

    expect(await confirmOnSiteVisit(actor, PLACE, body, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(reserve).toHaveBeenCalledWith("visit_on_site", actor.id, {
      limit: 20,
      windowSeconds: 600,
    });
    expect(recordOnSiteVisit).not.toHaveBeenCalled();
  });

  it("refuses a body of the wrong shape without touching the database", async () => {
    const { deps, withUserContext } = makeDeps({ result: "recorded", distance_m: 1 });

    expect(await confirmOnSiteVisit(actor, PLACE, { ...body, latitude: 200 }, deps)).toEqual({
      status: "invalid",
    });
    expect(await confirmOnSiteVisit(actor, PLACE, undefined, deps)).toEqual({ status: "invalid" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("maps invalid_parameter_value of the function (22023) to invalid, and rethrows anything else", async () => {
    const invalid = Object.assign(new Error("x"), { code: "22023" });

    expect(await confirmOnSiteVisit(actor, PLACE, body, makeDeps(invalid).deps)).toEqual({
      status: "invalid",
    });
    await expect(
      confirmOnSiteVisit(actor, PLACE, body, makeDeps(new Error("boom")).deps),
    ).rejects.toThrow("boom");
  });
});

describe("hasVisitedPlace", () => {
  it("reports the own visit state of the actor", async () => {
    const { deps } = makeDeps({ result: "recorded", distance_m: 1 }, true, true);

    expect(await hasVisitedPlace(actor, PLACE, deps)).toEqual({
      status: "ok",
      value: { visited: true },
    });
  });

  it("refuses a guest and a malformed id", async () => {
    const { deps, withUserContext } = makeDeps({ result: "recorded", distance_m: 1 });

    expect(await hasVisitedPlace(null, PLACE, deps)).toEqual({ status: "unauthenticated" });
    expect(await hasVisitedPlace(actor, "nope", deps)).toEqual({ status: "not_found" });
    expect(withUserContext).not.toHaveBeenCalled();
  });
});
