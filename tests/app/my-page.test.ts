import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// E9-1: the profile screen. A guest is sent to /login; a signed-in user sees the
// role, links to existing screens only (no dead entries, D-22 point 7) and a
// native logout form.
const mocks = vi.hoisted(() => ({ getActor: vi.fn(), redirect: vi.fn() }));

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

const { default: MyPage } = await import("@/app/my/page");

const id = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  mocks.getActor.mockReset().mockResolvedValue({ id, role: "user" });
  mocks.redirect.mockReset();
});

describe("profile page", () => {
  it("sends a guest to the login page and back to /my", async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(MyPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fmy");
  });

  it.each([
    ["user", "Użytkownik"],
    ["admin", "Administrator"],
  ] as const)("shows the profile of a %s with the role", async (role, label) => {
    mocks.getActor.mockResolvedValue({ id, role });

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toMatch(/<h1[^>]*>Profil<\/h1>/);
    expect(html).toContain(`Twoja rola: <strong>${label}</strong>`);
  });

  it("links only to existing screens", async () => {
    const html = renderToStaticMarkup(await MyPage());
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);

    // "Ustawienia" arrived with its screen (E9-5); "Napisz do nas" comes with E9-6.
    expect(hrefs).toEqual(["/my/collections", "/my/want-to-see", "/my/settings"]);
    expect(html).toContain("Ustawienia");
    expect(html).not.toContain("Napisz do nas");
  });

  it("ends the session with a native form post to the logout route", async () => {
    const html = renderToStaticMarkup(await MyPage());

    expect(html).toMatch(
      /<form action="\/api\/auth\/logout" method="post"><button [^>]*type="submit">Wyloguj<\/button><\/form>/,
    );
  });
});
