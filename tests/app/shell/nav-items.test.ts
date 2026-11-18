import { describe, expect, it } from "vitest";

import { activeNavHref, isCuratorPath, navItems } from "@/app/shell/nav-items";

describe("pozycje nawigacji", () => {
  it("ma 4 pozycje istniejących ekranów (Q7)", () => {
    expect(navItems.map((item) => item.href)).toEqual([
      "/",
      "/my/collections",
      "/my/want-to-see",
      "/my",
    ]);
  });

  it.each([
    ["/", "/"],
    ["/collections/demo", "/"],
    ["/places/abc", "/"],
    ["/my", "/my"],
    ["/my/collections", "/my/collections"],
    ["/my/want-to-see", "/my/want-to-see"],
    ["/login", null],
    ["/curator", null],
    ["/collectionsx", null],
    ["/my/inne", null],
  ])("bieżąca pozycja dla %s to %s", (pathname, expected) => {
    expect(activeNavHref(pathname)).toBe(expected);
  });

  it("rozpoznaje trasy panelu kuratora", () => {
    expect(isCuratorPath("/curator")).toBe(true);
    expect(isCuratorPath("/curator/collections/new")).toBe(true);
    expect(isCuratorPath("/curatorx")).toBe(false);
    expect(isCuratorPath("/my")).toBe(false);
  });
});
