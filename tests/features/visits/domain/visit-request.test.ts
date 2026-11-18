import { describe, expect, it } from "vitest";

import { VISIT_BODY_MAX_BYTES, VISIT_ACTION, visitLimit } from "@/features/visits/domain/limits";
import { parseVisitRequest } from "@/features/visits/domain/visit-request";

const ID = "55555555-5555-4555-8555-555555555555";
const valid = { latitude: 54.09, longitude: 18.79, accuracy: 12.5, clientVisitId: ID };

describe("parseVisitRequest", () => {
  it("accepts a reading and an attempt id, and renames the accuracy", () => {
    expect(parseVisitRequest(valid)).toEqual({
      latitude: 54.09,
      longitude: 18.79,
      accuracyM: 12.5,
      clientVisitId: ID,
    });
  });

  it("accepts the edges of the ranges", () => {
    expect(
      parseVisitRequest({ latitude: -90, longitude: 180, accuracy: 0, clientVisitId: ID }),
    ).not.toBeNull();
    expect(
      parseVisitRequest({ latitude: 90, longitude: -180, accuracy: 0, clientVisitId: ID }),
    ).not.toBeNull();
  });

  it.each([
    ["not an object", "x"],
    ["null", null],
    ["undefined", undefined],
    ["an array", [valid]],
    ["latitude above 90", { ...valid, latitude: 90.1 }],
    ["latitude below -90", { ...valid, latitude: -90.1 }],
    ["longitude above 180", { ...valid, longitude: 180.1 }],
    ["longitude below -180", { ...valid, longitude: -180.1 }],
    ["negative accuracy", { ...valid, accuracy: -1 }],
    ["infinite accuracy", { ...valid, accuracy: Infinity }],
    ["NaN latitude", { ...valid, latitude: Number.NaN }],
    ["a string latitude", { ...valid, latitude: "54" }],
    ["a missing id", { ...valid, clientVisitId: undefined }],
    ["an id that is not a UUID", { ...valid, clientVisitId: "abc" }],
  ])("rejects %s", (_name, body) => {
    expect(parseVisitRequest(body)).toBeNull();
  });
});

describe("visit limits", () => {
  it("is 20 attempts per 10 minutes and a 16 KB body", () => {
    expect(VISIT_ACTION).toBe("visit_on_site");
    expect(visitLimit).toEqual({ limit: 20, windowSeconds: 600 });
    expect(VISIT_BODY_MAX_BYTES).toBe(16384);
  });
});
