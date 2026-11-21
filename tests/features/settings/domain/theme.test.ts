import { describe, expect, it } from "vitest";

import { DEFAULT_THEME, THEMES, parseTheme } from "@/features/settings/domain/theme";

describe("parseTheme", () => {
  it.each([
    ["dark", "dark"],
    ["light", "light"],
    ["LIGHT", null],
    ["", null],
    ["neon", null],
    [undefined, null],
    [null, null],
    [1, null],
  ])("%s daje %s", (value, theme) => {
    expect(parseTheme(value)).toBe(theme);
  });

  it("zna dokładnie motywy z listy, a domyślny jest nocny (D-22)", () => {
    expect([...THEMES]).toEqual(["dark", "light"]);
    expect(DEFAULT_THEME).toBe("dark");
  });
});
