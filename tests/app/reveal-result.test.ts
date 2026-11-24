import { afterEach, describe, expect, it, vi } from "vitest";

import { revealResult } from "@/app/places/[placeId]/reveal-result";

// Window 667 px high, pinned bar 80 px: the free area ends at 667 - 80 - 8 = 579.
function setup(first: { top: number; bottom: number }, last: { top: number; bottom: number }) {
  const scrollBy = vi.fn();

  vi.stubGlobal("window", {
    innerHeight: 667,
    matchMedia: () => ({ matches: false }),
    scrollBy,
  });
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "80px" }));

  const element = (rect: { top: number; bottom: number }) =>
    ({ getBoundingClientRect: () => rect }) as unknown as HTMLElement;

  revealResult(element(first), element(last));

  return scrollBy;
}

afterEach(() => vi.unstubAllGlobals());

describe("revealResult with a message and the list below it", () => {
  it("does not scroll when both are in the window above the bar", () => {
    expect(setup({ top: 100, bottom: 150 }, { top: 160, bottom: 400 })).not.toHaveBeenCalled();
  });

  it("scrolls just enough to show the end of the list when the message is in view", () => {
    expect(setup({ top: 300, bottom: 350 }, { top: 360, bottom: 600 })).toHaveBeenCalledWith({
      top: 21,
      behavior: "smooth",
    });
  });

  it("puts the message at the top when both together do not fit (several collections)", () => {
    // The message at 200, the list ends at 1000: 800 px is more than the window.
    expect(setup({ top: 200, bottom: 250 }, { top: 260, bottom: 1000 })).toHaveBeenCalledWith({
      top: 192,
      behavior: "smooth",
    });
  });

  it("never leaves the message above the top edge", () => {
    expect(setup({ top: -40, bottom: 10 }, { top: 20, bottom: 200 })).toHaveBeenCalledWith({
      top: -48,
      behavior: "smooth",
    });
  });
});
