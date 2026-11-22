import { describe, expect, it } from "vitest";

import { ACCESS_RESTRICTIONS } from "@/features/catalog/domain/place";
import {
  ACCESS_RESTRICTION_LABELS,
  accessNotice,
} from "@/features/catalog/domain/place-access-notice";

describe("accessNotice", () => {
  it("has no notice for a place without a restriction", () => {
    expect(accessNotice("none")).toBeNull();
  });

  it.each([
    ["private", "Teren prywatny"],
    ["fenced", "Teren ogrodzony"],
    ["ruin", "Ruina"],
  ] as const)("gives a calm notice for %s that asks not to enter", (restriction, title) => {
    const notice = accessNotice(restriction);

    expect(notice?.title).toBe(title);
    expect(notice?.text).toContain("nie wchodź na teren");
    expect(notice?.text).not.toContain("!");
  });

  it("labels every restriction for the curator form", () => {
    expect(Object.keys(ACCESS_RESTRICTION_LABELS)).toEqual([...ACCESS_RESTRICTIONS]);
  });
});
