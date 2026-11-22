import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmDiscard, differsFromSaved } from "@/app/curator/unsaved-changes";

const saved = { title: "Zamki", summary: "Linia 1\nLinia 2", region: "pomorskie" };

describe("differsFromSaved", () => {
  it("is false for the saved values, also when the browser sends CRLF line breaks", () => {
    expect(differsFromSaved(saved, saved)).toBe(false);
    expect(differsFromSaved({ ...saved, summary: "Linia 1\r\nLinia 2" }, saved)).toBe(false);
  });

  it("is true when any field changed", () => {
    expect(differsFromSaved({ ...saved, title: "Zamki!" }, saved)).toBe(true);
    expect(differsFromSaved({ ...saved, summary: "inny" }, saved)).toBe(true);
    expect(differsFromSaved({ ...saved, region: "slaskie" }, saved)).toBe(true);
  });
});

describe("confirmDiscard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not ask when nothing is unsaved", () => {
    const confirm = vi.fn();
    vi.stubGlobal("window", { confirm });

    expect(confirmDiscard(false)).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks when text is unsaved and follows the answer", () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("window", { confirm });

    expect(confirmDiscard(true)).toBe(false);
    expect(confirmDiscard(true)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("przepadnie"));
  });
});
