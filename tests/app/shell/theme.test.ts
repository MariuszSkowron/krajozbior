import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  getActor: vi.fn(),
  saveTheme: vi.fn(),
  logFailure: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.set, get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));
vi.mock("@/features/settings/infrastructure/settings-deps", () => ({
  getSettingsDeps: () => ({
    withUserContext: async (_actor: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    repository: { readTheme: vi.fn(), saveTheme: mocks.saveTheme },
  }),
}));
vi.mock("@/lib/log-failure", () => ({ logFailure: mocks.logFailure }));

const { themeFromCookie, themeSetCookieHeader } = await import("@/app/shell/theme");
const { setTheme } = await import("@/app/shell/theme-actions");

beforeEach(() => {
  mocks.set.mockReset();
  mocks.getActor.mockReset().mockResolvedValue(null);
  mocks.saveTheme.mockReset().mockResolvedValue(undefined);
  mocks.logFailure.mockReset();
});

describe("themeSetCookieHeader", () => {
  it("builds the same cookie as the action sets", () => {
    expect(themeSetCookieHeader("light")).toBe(
      "krajozbior-theme=light; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax",
    );
  });

  it("adds Secure in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(themeSetCookieHeader("dark")).toMatch(/; Secure$/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
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

  it("gość dostaje tylko ciasteczko, bez zapisu na koncie", async () => {
    await setTheme(form("light"));

    expect(mocks.saveTheme).not.toHaveBeenCalled();
  });

  it("zalogowana osoba dostaje też zapis na koncie, a właściciel pochodzi z sesji", async () => {
    mocks.getActor.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", role: "user" });

    await setTheme(form("light"));

    expect(mocks.saveTheme).toHaveBeenCalledWith(expect.anything(), "light");
  });

  it("zapisuje na koncie motyw po normalizacji, nie surową wartość z formularza", async () => {
    mocks.getActor.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", role: "user" });

    await setTheme(form("neon"));

    expect(mocks.saveTheme).toHaveBeenCalledWith(expect.anything(), "dark");
  });

  it("awaria zapisu na koncie nie cofa ciasteczka i trafia do dziennika", async () => {
    mocks.getActor.mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111", role: "user" });
    mocks.saveTheme.mockRejectedValue(new Error("database down"));

    await expect(setTheme(form("light"))).resolves.toBeUndefined();

    expect(mocks.set).toHaveBeenCalledWith("krajozbior-theme", "light", expect.anything());
    expect(mocks.logFailure).toHaveBeenCalledWith("Theme save", expect.any(Error));
  });
});
