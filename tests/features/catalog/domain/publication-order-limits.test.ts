import { describe, expect, it } from "vitest";

import {
  CURATOR_BODY_MAX_BYTES,
  CURATOR_WRITE_ACTION,
  curatorWriteLimit,
} from "@/features/catalog/domain/limits";
import { nextPosition, validateReorder } from "@/features/catalog/domain/order";
import { canDeleteDraft, canPublish, canUnpublish } from "@/features/catalog/domain/publication";

describe("publication rules", () => {
  it("publishes only a draft with at least one place", () => {
    expect(canPublish("draft", 1)).toEqual({ ok: true });
    expect(canPublish("draft", 0)).toEqual({ ok: false, reason: "no_places" });
    expect(canPublish("published", 3)).toEqual({ ok: false, reason: "already_published" });
  });

  it("withdraws only a published collection", () => {
    expect(canUnpublish("published")).toBe(true);
    expect(canUnpublish("draft")).toBe(false);
  });

  it("deletes only a draft that was never published", () => {
    expect(canDeleteDraft("draft", null)).toEqual({ ok: true });
    expect(canDeleteDraft("draft", new Date())).toEqual({ ok: false, reason: "was_published" });
    expect(canDeleteDraft("published", null)).toEqual({ ok: false, reason: "was_published" });
  });
});

describe("order rules", () => {
  it("gives the next position", () => {
    expect(nextPosition([])).toBe(1);
    expect(nextPosition([1, 2, 5])).toBe(6);
  });

  it("accepts a permutation and refuses everything else", () => {
    const current = ["a", "b", "c"];

    expect(validateReorder(current, ["c", "a", "b"])).toEqual({
      ok: true,
      placeIds: ["c", "a", "b"],
    });
    expect(validateReorder(current, ["a", "b"])).toEqual({ ok: false });
    expect(validateReorder(current, ["a", "a", "b"])).toEqual({ ok: false });
    expect(validateReorder(current, ["a", "b", "x"])).toEqual({ ok: false });
    expect(validateReorder(current, ["a", "b", 3])).toEqual({ ok: false });
    expect(validateReorder(current, "abc")).toEqual({ ok: false });
  });
});

describe("curator limits", () => {
  it("keeps the starting values", () => {
    expect(CURATOR_WRITE_ACTION).toBe("curator_write");
    expect(curatorWriteLimit).toEqual({ limit: 120, windowSeconds: 600 });
    expect(CURATOR_BODY_MAX_BYTES).toBe(16384);
  });
});
