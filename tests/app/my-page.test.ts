import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// E9-1 and E9-2: the profile screen. A guest is sent to /login; a signed-in user
// sees the name, region and visibility of the profile, the role, links to
// existing screens only (no dead entries, D-22 point 7) and a native logout form.
const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  redirect: vi.fn(),
  getMyProfile: vi.fn(),
  getMyStats: vi.fn(),
  getApprovedOrganizations: vi.fn(),
}));

vi.mock("@/app/request-organizations", () => ({
  getApprovedOrganizations: mocks.getApprovedOrganizations,
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
vi.mock("@/features/profile/infrastructure/profile-deps", () => ({
  getProfileDeps: () => ({}),
  getProfileStatsDeps: () => ({}),
}));
vi.mock("@/features/profile/application/profile", () => ({ getMyProfile: mocks.getMyProfile }));
vi.mock("@/features/profile/application/stats", () => ({ getMyStats: mocks.getMyStats }));

const { default: MyPage } = await import("@/app/my/page");

const id = "11111111-1111-4111-8111-111111111111";
const empty = { firstName: null, familyInitial: null, region: null, visibility: "private" };

beforeEach(() => {
  mocks.getActor.mockReset().mockResolvedValue({ id, role: "user" });
  mocks.redirect.mockReset();
  mocks.getApprovedOrganizations.mockReset().mockResolvedValue([]);
  mocks.getMyProfile.mockReset().mockResolvedValue({ status: "ok", value: empty });
  mocks.getMyStats
    .mockReset()
    .mockResolvedValue({ status: "ok", value: { visitedPlaces: 0, regions: 0, kmInTransit: 0 } });
});

describe("profile page", () => {
  it("sends a guest to the login page and back to /my", async () => {
    mocks.getActor.mockResolvedValue(null);

    await expect(MyPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login?returnTo=%2Fmy");
    expect(mocks.getMyProfile).not.toHaveBeenCalled();
  });

  it("shows an explorer no role at all", async () => {
    const html = renderToStaticMarkup(await MyPage());

    expect(html).toMatch(/<h1[^>]*>Profil<\/h1>/);
    expect(html).not.toContain("Twoja rola");
    expect(html).not.toContain("Użytkownik");
    expect(html).not.toContain("Administrator");
    expect(html).not.toContain("profile-curator");
  });

  it("says Administrator to an administrator, without a sentence about a panel", async () => {
    mocks.getActor.mockResolvedValue({ id, role: "admin" });

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toMatch(/data-testid="profile-admin"[^>]*><strong>Administrator<\/strong>/);
    expect(html).not.toContain("w przygotowaniu");
    expect(html).not.toContain("Twoja rola");
  });

  it("describes a curator with the organization, the link to the panel and the explorer sentence", async () => {
    mocks.getApprovedOrganizations.mockResolvedValue([{ id: "o1", name: "Gmina Wilcza" }]);

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toContain("Kurator · Gmina Wilcza");
    expect(html).toMatch(/href="\/curator">Przejdź do panelu kuratora<\/a>/);
    expect(html).toContain("Tu są Twoje wizyty i liczby jako odkrywcy.");
  });

  it("lists every approved organization of a curator", async () => {
    mocks.getApprovedOrganizations.mockResolvedValue([
      { id: "o1", name: "Gmina" },
      { id: "o2", name: "Muzeum" },
    ]);

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toContain("Kurator · Gmina");
    expect(html).toContain("Kurator · Muzeum");
  });

  it("keeps the profile when the organizations cannot be read, and logs the class only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getApprovedOrganizations.mockRejectedValue(new Error("db down"));

    const html = renderToStaticMarkup(await MyPage());

    expect(html).not.toContain("Kurator ·");
    expect(html).toContain("Wyloguj");
    expect(spy).toHaveBeenCalledWith("Profile organizations failed:", "Error");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("db down");
    spy.mockRestore();
  });

  it("says Odkrywca, the letter O and a private profile when nothing was saved", async () => {
    const html = renderToStaticMarkup(await MyPage());

    expect(html).toContain(">Odkrywca<");
    expect(html).toMatch(/aria-hidden="true">O<\/span>/);
    expect(html).toContain("Profil niewidoczny");
    expect(html).not.toContain("Profil widoczny");
  });

  it('shows "Anna K.", the region and a visible profile', async () => {
    mocks.getMyProfile.mockResolvedValue({
      status: "ok",
      value: { firstName: "Anna", familyInitial: "K", region: "pomorskie", visibility: "public" },
    });

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toContain(">Anna K.<");
    expect(html).toMatch(/aria-hidden="true">A<\/span>/);
    expect(html).toContain("Pomorskie");
    expect(html).toContain("Profil widoczny");
  });

  it("does not render when the profile cannot be read", async () => {
    mocks.getMyProfile.mockResolvedValue({ status: "unauthenticated" });

    await expect(MyPage()).rejects.toThrow("Profile could not be read");
  });

  it("shows the numbers as a definition list a screen reader can read, with the km caption", async () => {
    mocks.getMyStats.mockResolvedValue({
      status: "ok",
      value: { visitedPlaces: 12, regions: 3, kmInTransit: 148.26 },
    });

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toMatch(/<dl[^>]*data-testid="profile-stats"/);
    expect(html).toMatch(/<dt>Odkryte miejsca<\/dt><dd[^>]*>12<\/dd>/);
    expect(html).toMatch(/<dt>Odkryte regiony<\/dt><dd[^>]*>3<\/dd>/);
    expect(html).toMatch(/<dt>km w trasie \(w linii prostej\)<\/dt><dd[^>]*>148,3<\/dd>/);
    // The tile of legendary cards waits for E6 (Q14).
    expect(html).not.toContain("legendarn");
  });

  it.each([
    ["the database fails", () => mocks.getMyStats.mockRejectedValue(new Error("db down"))],
    [
      "the outcome is not ok",
      () => mocks.getMyStats.mockResolvedValue({ status: "unauthenticated" }),
    ],
  ])("keeps the profile working and says so in the tiles when %s", async (_name, arrange) => {
    arrange();

    const html = renderToStaticMarkup(await MyPage());

    expect(html).toContain('data-testid="profile-stats-error"');
    expect(html).toContain("Nie udało się wczytać Twoich liczb. Odśwież stronę za chwilę.");
    expect(html).not.toContain('data-testid="profile-stats"');
    // The rest of the profile stays: links and logout.
    expect(html).toContain("/my/settings");
    expect(html).toContain("Wyloguj");
  });

  it("logs a database failure by context and error class only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getMyStats.mockRejectedValue(new Error("db down"));

    await MyPage();

    expect(spy).toHaveBeenCalledWith("Profile statistics failed:", "Error");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("db down");
    spy.mockRestore();
  });

  it("links only to existing screens", async () => {
    const html = renderToStaticMarkup(await MyPage());
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);

    // "Ustawienia" arrived with its screen (E9-5); "Napisz do nas" is a mailto link (E9-6a).
    // The main menu has "Moje kolekcje" and "Chcę zobaczyć", so the profile does not repeat them.
    expect(hrefs).toEqual(["/my/settings", "mailto:kontakt@mariuszskowron.pl"]);
    expect(html).not.toContain("Moje kolekcje");
    expect(html).not.toContain("Chcę zobaczyć");
    expect(html).toContain("Ustawienia");
    expect(html).toContain("Napisz do nas");
  });

  it("ends the session with a native form post to the logout route", async () => {
    const html = renderToStaticMarkup(await MyPage());

    expect(html).toMatch(
      /<form action="\/api\/auth\/logout" method="post"><button [^>]*type="submit">Wyloguj<\/button><\/form>/,
    );
  });
});
