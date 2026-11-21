import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// E9-5: the minimal settings screen and the deletion screen. A guest is sent to
// /login and back; the deletion form is a native post of the word only; an old
// sign-in gets "log in again" instead of the form (Q7); an administrator gets an
// explanation (Q8).
const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  redirect: vi.fn(),
  getSessionCreatedAt: vi.fn(),
}));

vi.mock("@/app/request-actor", () => ({
  getRequestActor: mocks.getActor,
  loginHref: (path: string) => `/login?returnTo=${encodeURIComponent(path)}`,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getSessionCreatedAt: mocks.getSessionCreatedAt }),
}));
// The profile section of the settings has its own test (my-profile-pages.test.ts).
vi.mock("@/features/profile/infrastructure/profile-deps", () => ({ getProfileDeps: () => ({}) }));
vi.mock("@/features/profile/application/profile", () => ({
  getMyProfile: async () => ({
    status: "ok",
    value: { firstName: null, familyInitial: null, region: null, visibility: "private" },
  }),
}));

const { default: SettingsPage } = await import("@/app/my/settings/page");
const { default: DeleteAccountPage } = await import("@/app/my/delete-account/page");

const id = "11111111-1111-4111-8111-111111111111";
const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await DeleteAccountPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  mocks.getActor.mockReset().mockResolvedValue({ id, role: "user" });
  mocks.redirect.mockReset();
  mocks.getSessionCreatedAt.mockReset().mockResolvedValue(new Date());
});

describe("settings page", () => {
  it("sends a guest to the login page and back to /my/settings", async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(SettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fmy%2Fsettings");
  });

  it("holds the sections Profil and Konto, and the one link of Konto leads to the deletion screen", async () => {
    const html = renderToStaticMarkup(await SettingsPage({ searchParams: Promise.resolve({}) }));
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);

    expect(html).toMatch(/<h1[^>]*>Ustawienia<\/h1>/);
    expect(html).toMatch(/<h2[^>]*>Konto<\/h2>/);
    expect(hrefs).toEqual(["/my/delete-account"]);
    expect(html).toContain("Usuń konto");
  });
});

describe("deletion screen", () => {
  it("sends a guest to the login page and back to the deletion screen", async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fmy%2Fdelete-account");
  });

  it("shows a native form that posts only the confirmation word, with what goes and what stays", async () => {
    const html = await render();

    expect(html).toMatch(/<form [^>]*action="\/api\/me\/account\/deletion"[^>]*method="post"/);
    expect(html).toContain('name="confirmation"');
    expect(html).not.toMatch(/name="(userId|id|accountId)"/);
    expect(html).toContain("Tego nie da się cofnąć.");
    expect(html).toContain("Co zniknie");
    expect(html).toContain("Co zostanie");
    expect(html).toContain("button--danger");
    expect(html).not.toContain('role="alert"');
  });

  it("asks for a new sign-in after 15 minutes and comes back to this screen", async () => {
    mocks.getSessionCreatedAt.mockResolvedValue(new Date(Date.now() - 3_600_000));

    const html = await render();

    expect(html).not.toContain('name="confirmation"');
    expect(html).toContain('<input type="hidden" name="returnTo" value="/my/delete-account"/>');
    expect(html).toContain("Zaloguj się ponownie");
  });

  it("does not show the form without a session start", async () => {
    mocks.getSessionCreatedAt.mockResolvedValue(null);

    expect(await render()).not.toContain('name="confirmation"');
  });

  it("tells an administrator that the team deletes the account and shows no form", async () => {
    mocks.getActor.mockResolvedValue({ id, role: "admin" });

    const html = await render();

    expect(html).toContain("Konto administratora usuwa zespół");
    expect(html).not.toContain("<form");
    expect(mocks.getSessionCreatedAt).not.toHaveBeenCalled();
  });

  it("explains the refusals the route sends back and ignores an unknown code", async () => {
    for (const [code, text] of [
      ["managed_account", "jesteś jedynym członkiem organizacji"],
      ["invalid_confirmation", "Wpisz dokładnie słowo USUŃ"],
      ["stale_session", "Minęło ponad 15 minut od logowania"],
      ["invalid_request", "Nie udało się odczytać formularza"],
      ["unavailable", "Konto zostało bez zmian"],
    ]) {
      const html = await render({ blad: code });

      expect(html, code).toContain('role="alert"');
      expect(html, code).toContain(text);
    }
    expect(await render({ blad: "nieznany" })).not.toContain('role="alert"');
  });

  it("ignores a code that is a property name of every object instead of crashing", async () => {
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      const html = await render({ blad: code });

      expect(html, code).not.toContain('role="alert"');
      expect(html, code).toContain("Usuń konto na stałe");
    }
  });

  it("marks the field invalid after a wrong word and ties it to the error message", async () => {
    const html = await render({ blad: "invalid_confirmation" });

    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="deletion-error"');
    expect(html).toContain('id="deletion-error"');
    expect(await render()).not.toContain("aria-describedby");
  });
});
