import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.set, get: () => undefined }),
}));

const { themeFromCookie } = await import("@/app/shell/theme");
const { setTheme } = await import("@/app/shell/theme-actions");

beforeEach(() => {
  mocks.set.mockReset();
});

describe("themeFromCookie", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    [undefined, "dark"],
    ["", "dark"],
    ["xyz", "dark"],
    ["LIGHT", "dark"],
  ] as const)("%s daje %s", (value, theme) => {
    expect(themeFromCookie(value)).toBe(theme);
  });
});

describe("setTheme", () => {
  const form = (theme: string) => {
    const data = new FormData();
    data.set("theme", theme);
    return data;
  };

  it("zapisuje ciasteczko wyglądu na rok, bez dostępu do skryptów", async () => {
    await setTheme(form("light"));

    expect(mocks.set).toHaveBeenCalledWith(
      "krajozbior-theme",
      "light",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      }),
    );
  });

  it("nieznana wartość zapisuje motyw nocny", async () => {
    await setTheme(form("neon"));

    expect(mocks.set).toHaveBeenCalledWith("krajozbior-theme", "dark", expect.anything());
  });

  it("brak pola zapisuje motyw nocny", async () => {
    await setTheme(new FormData());

    expect(mocks.set).toHaveBeenCalledWith("krajozbior-theme", "dark", expect.anything());
  });
});
