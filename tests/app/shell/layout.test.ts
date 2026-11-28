import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  themeCookie: undefined as string | undefined,
  getActor: vi.fn(),
  getMyProfile: vi.fn(),
  listMemberships: vi.fn(),
  pathname: "/",
  search: "",
  termsAccepted: true,
  url: "/",
}));

vi.mock("@/app/auth-photo-loader", () => ({ loadAuthPhoto: async () => null }));
vi.mock("@/app/shell/terms-state", () => ({ shellTermsAccepted: async () => mocks.termsAccepted }));
vi.mock("next/headers", () => ({
  // The address of the first request, as the proxy passed it before the fix of the client
  // navigation bypass (F-K3, M1). The shell must not decide by it: after a `next/link`
  // navigation it still names the first page, while usePathname() names the current one.
  headers: async () => new Headers({ "x-krajozbior-url": mocks.url }),
  cookies: async () => ({
    get: (name: string) =>
      name === "krajozbior-theme" && mocks.themeCookie !== undefined
        ? { name, value: mocks.themeCookie }
        : undefined,
  }),
}));
// next/font/local works only inside the Next.js compiler; the layout needs only the class names.
vi.mock("@/app/fonts", () => ({
  geist: { variable: "font-geist" },
  geistMono: { variable: "font-geist-mono" },
  instrumentSerif: { variable: "font-instrument-serif" },
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));

vi.mock("@/features/profile/infrastructure/profile-deps", () => ({ getProfileDeps: () => ({}) }));
vi.mock("@/features/profile/application/profile", () => ({ getMyProfile: mocks.getMyProfile }));
vi.mock("@/features/organizations/infrastructure/postgres-organization-reader", () => ({
  listMyOrganizationsDeps: {
    withUserContext: async (_actor: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    listMemberships: mocks.listMemberships,
  },
}));

const { default: RootLayout, generateViewport } = await import("@/app/layout");

const id = "11111111-1111-4111-8111-111111111111";
const as = (role: "user" | "admin") => ({ id, role });

async function shell(): Promise<string> {
  return renderToStaticMarkup(
    await RootLayout({ children: createElement("p", null, "Treść strony") }),
  );
}

const header = (html: string) => html.match(/<header[^>]*>(.*?)<\/header>/)?.[1] ?? "";

beforeEach(() => {
  vi.spyOn(console, "error")
    .mockClear()
    .mockImplementation(() => undefined);
  mocks.getActor.mockReset().mockResolvedValue(null);
  mocks.listMemberships.mockReset().mockResolvedValue([]);
  mocks.getMyProfile.mockReset().mockResolvedValue({ status: "ok", value: { firstName: null } });
  mocks.pathname = "/";
  mocks.search = "";
  mocks.themeCookie = undefined;
  mocks.termsAccepted = true;
  mocks.url = "/";
});

describe("app shell", () => {
  it("puts the skip link first, then the test bar and header, the main content and the footer", async () => {
    const html = await shell();
    const body = html.match(/<body[^>]*>(.*)<\/body>/)?.[1] ?? "";

    expect(body).toMatch(
      /^<a class="[^"]*skipLink[^"]*" href="#tresc">Przejdź do treści<\/a><div class="[^"]*top[^"]*"><div [^>]*testBanner[^>]*>.*<\/div><header/,
    );
    expect(body).toMatch(
      /<\/header><\/div><main id="tresc" tabindex="-1"[^>]*><p>Treść strony<\/p><\/main><footer/,
    );
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  it("shows the test-version bar with a link to the main rules (E11-Q2 A)", async () => {
    const html = await shell();

    expect(html).toMatch(
      /role="region" aria-label="Wersja konkursowa"><p><strong>Wersja konkursowa<\/strong> — część funkcji uruchomimy później\. <a href="\/zasady">Najważniejsze zasady<\/a><\/p><button type="button"[^>]*>Zamknij<\/button>/,
    );
  });

  it("has a footer with the legal pages and the contact address, for a guest too (F-K3)", async () => {
    const html = await shell();
    const footer = html.match(/<footer[^>]*>.*<\/footer>/)?.[0] ?? "";

    expect(footer).toContain('aria-label="Informacje prawne i kontakt"');
    for (const [href, label] of [
      ["/regulamin", "Regulamin"],
      ["/polityka-prywatnosci", "Polityka prywatności"],
      ["/zasady", "Najważniejsze zasady"],
      ["mailto:kontakt@krajozbior.pl", "Kontakt"],
    ]) {
      expect(footer).toMatch(new RegExp(`href="${href}">${label}</a>`));
    }
  });

  it("has the report link in the footer, pointing at the current page (E5-0)", async () => {
    mocks.pathname = "/collections/demo";
    const html = await shell();
    const footer = html.match(/<footer[^>]*>.*<\/footer>/)?.[0] ?? "";
    const href = footer.match(/href="(mailto:[^"]*subject=[^"]*)">Zgłoś naruszenie<\/a>/)?.[1];

    expect(href).toBeDefined();
    expect(decodeURIComponent(href!.replaceAll("&amp;", "&"))).toContain("/collections/demo");
    expect(footer).toMatch(/href="mailto:kontakt@krajozbior\.pl">Kontakt<\/a>/);
  });

  describe("the terms screen (E11-Q4 A)", () => {
    it("replaces the page of a signed-in account that has not accepted the terms, and hides the menu", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.termsAccepted = false;
      mocks.url = mocks.pathname = "/my/collections";

      const html = await shell();

      expect(html).toContain("<h1>Zanim zaczniesz</h1>");
      expect(html).toContain('name="returnTo" value="/my/collections"');
      expect(html).not.toContain("Treść strony");
      expect(html).not.toContain('aria-label="Główna"');
      expect(html).not.toMatch(/<body class="[^"]*withNav/);
      // The logout stays in the header, and the footer links stay.
      expect(header(html)).toContain("Wyloguj");
      expect(html).toContain("<footer");
    });

    it.each(["/regulamin", "/polityka-prywatnosci?x=1", "/zasady/", "/oswiadczenie-o-zdjeciach"])(
      "keeps the legal page %s readable before the acceptance, without the menu",
      async (url) => {
        mocks.getActor.mockResolvedValue(as("user"));
        mocks.termsAccepted = false;
        mocks.url = url;
        [mocks.pathname = "/", mocks.search = ""] = url.split("?");

        const html = await shell();

        expect(html).toContain("<p>Treść strony</p>");
        expect(html).not.toContain("Zanim zaczniesz");
        expect(html).not.toContain('aria-label="Główna"');
      },
    );

    // Regression (M1 of the level A review): Next.js does not draw the layout again on a
    // `next/link` navigation, so a decision taken from the first request (the legal page)
    // let the account reach "/" by the application name in the header without the screen.
    it("decides by the current address after a client navigation from a legal page", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.termsAccepted = false;
      mocks.url = "/regulamin";
      mocks.pathname = "/";

      const html = await shell();

      expect(html).toContain("<h1>Zanim zaczniesz</h1>");
      expect(html).not.toContain("Treść strony");
    });

    it("shows the message of a refused post from the `zgoda` parameter", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.termsAccepted = false;
      mocks.search = "zgoda=wymagana";

      expect(await shell()).toMatch(/role="alert"[^>]*>.*Zaznacz pole/);
    });

    it("shows the page and the menu after the acceptance", async () => {
      mocks.getActor.mockResolvedValue(as("user"));

      const html = await shell();

      expect(html).toContain("<p>Treść strony</p>");
      expect(html).toContain('aria-label="Główna"');
    });

    it("does not show the curator label to an account that has not accepted the terms, but keeps the logout", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.listMemberships.mockResolvedValue([
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Gmina",
          slug: "gmina",
          kind: "municipality",
          status: "approved",
        },
      ]);
      mocks.termsAccepted = false;

      const html = await shell();

      expect(html).not.toContain("Kurator ·");
      // No menu here, so the header keeps the way out (and no "Profil").
      expect(header(html)).toContain("Wyloguj");
      // Without a menu the logout is not hidden on a phone.
      expect(header(html)).not.toContain("logoutDesktopOnly");
      expect(header(html)).not.toContain("Profil");
    });

    it("does not ask a guest for anything", async () => {
      mocks.termsAccepted = false;

      const html = await shell();

      expect(html).toContain("<p>Treść strony</p>");
      expect(html).not.toContain("Zanim zaczniesz");
    });
  });

  it("links the application name to the start page", async () => {
    expect(header(await shell())).toMatch(/^<a class="[^"]*brand[^"]*" href="\/">Krajozbiór<\/a>/);
  });

  it("gives a guest a login link back to the current page", async () => {
    mocks.pathname = "/my";

    const html = await shell();

    expect(header(html)).toContain('href="/login?returnTo=%2Fmy">Zaloguj się</a>');
    expect(header(html)).toContain('href="/login/zaloz-konto?returnTo=%2Fmy">Załóż konto</a>');
    expect(html).not.toContain("Wyloguj");
  });

  it.each(["user", "admin"] as const)("gives %s no guest link", async (role) => {
    mocks.getActor.mockResolvedValue(as(role));

    const html = await shell();

    expect(html).not.toContain("Zaloguj się");
    expect(html).not.toContain("Użytkownik");
    expect(html).not.toContain("Twoja rola");
  });

  // UX-06: "Profil" is only in the menu, the header has neither the name nor the profile link.
  it.each(["user", "admin"] as const)(
    "does not repeat Profil or the first name in the header of %s (the menu has Profil)",
    async (role) => {
      mocks.getActor.mockResolvedValue(as(role));
      mocks.getMyProfile.mockResolvedValue({ status: "ok", value: { firstName: "Anna" } });

      const html = await shell();

      expect(header(html)).not.toContain('href="/my"');
      expect(header(html)).not.toContain("Profil");
      expect(header(html)).not.toContain("Anna");
      expect(html).toMatch(/aria-label="Główna"[^>]*>.*Profil/);
      // D-54 P20 B: the logout is in the header on a computer (hidden by CSS on a phone, where
      // it is on the profile), and the profile is in the menu.
      expect(header(html)).toMatch(/<button class="[^"]*logoutDesktopOnly[^"]*"[^>]*>Wyloguj</);
      expect(mocks.getMyProfile).not.toHaveBeenCalled();
    },
  );

  it("does not read the profile for a guest", async () => {
    await shell();

    expect(mocks.getMyProfile).not.toHaveBeenCalled();
  });

  it("names the administrator next to the profile link", async () => {
    mocks.getActor.mockResolvedValue(as("admin"));

    expect(header(await shell())).toMatch(/data-role="admin">.*Administrator<\/span><\/p>/);
  });

  it("does not name the administrator for an explorer", async () => {
    mocks.getActor.mockResolvedValue(as("user"));

    expect(header(await shell())).not.toContain("Administrator");
  });

  const organization = (status: "approved" | "suspended") => ({
    id: "22222222-2222-4222-8222-222222222222",
    name: "Gmina",
    slug: "gmina",
    kind: "municipality",
    status,
  });

  it("shows the link to the curator panel for a member of an approved organization", async () => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.listMemberships.mockResolvedValue([organization("approved")]);

    expect(header(await shell())).toMatch(
      /href="\/curator"><span class="[^"]*curatorText[^"]*">Kurator · Gmina<\/span><\/a>/,
    );
  });

  it("names the first approved organization when the curator has several", async () => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.listMemberships.mockResolvedValue([
      { ...organization("approved"), name: "Gmina" },
      { ...organization("approved"), id: "33333333-3333-4333-8333-333333333333", name: "Muzeum" },
    ]);

    const html = header(await shell());

    expect(html).toContain("Kurator · Gmina");
    expect(html).not.toContain("Muzeum");
  });

  it("shows the curator label of an administrator who is also a curator", async () => {
    mocks.getActor.mockResolvedValue(as("admin"));
    mocks.listMemberships.mockResolvedValue([organization("approved")]);

    const html = header(await shell());

    expect(html).toContain("Administrator");
    expect(html).toContain("Kurator · Gmina");
  });

  it.each([
    ["has no organization", []],
    ["has only a suspended organization", [organization("suspended")]],
  ])("shows no panel link for an account that %s", async (_name, memberships) => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.listMemberships.mockResolvedValue(memberships);

    expect(await shell()).not.toContain("Kurator ·");
  });

  it("shows no panel link to a guest and does not look organizations up", async () => {
    expect(await shell()).not.toContain("Kurator ·");
    expect(mocks.listMemberships).not.toHaveBeenCalled();
  });

  it("draws the shell without the link and logs the error class when the lookup fails", async () => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.listMemberships.mockRejectedValue(new Error("db down: secret"));

    const html = await shell();

    expect(html).not.toContain("Kurator ·");
    expect(html).toContain('aria-label="Główna"');
    expect(console.error).toHaveBeenCalledWith("Curator link lookup failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("draws the guest shell and logs only the error class when the session lookup fails", async () => {
    mocks.getActor.mockRejectedValue(new Error("auth down: secret-session-id"));

    const html = await shell();

    expect(header(html)).toContain(">Zaloguj się</a>");
    expect(html).not.toContain("Wyloguj");
    expect(html).toContain("<p>Treść strony</p>");
    expect(console.error).toHaveBeenCalledWith("Session lookup failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("passes the Next.js request-time signal on instead of treating it as a session failure", async () => {
    const dynamicUsage = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    mocks.getActor.mockRejectedValue(dynamicUsage);

    await expect(shell()).rejects.toBe(dynamicUsage);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("sets the viewport for a phone with the night theme colour by default", async () => {
    expect(await generateViewport()).toEqual({
      width: "device-width",
      initialScale: 1,
      themeColor: "#0B0D12",
      colorScheme: "dark",
    });
  });

  it("starts in the night theme without a cookie and for an unknown value", async () => {
    expect(await shell()).toMatch(/^<html lang="pl" class="theme-dark /);

    mocks.themeCookie = "xyz";
    expect(await shell()).toMatch(/^<html lang="pl" class="theme-dark /);
  });

  it("uses the light theme and its bar colour for the light cookie", async () => {
    mocks.themeCookie = "light";

    expect(await shell()).toMatch(/^<html lang="pl" class="theme-light /);
    expect(await generateViewport()).toMatchObject({ themeColor: "#F4F2EC", colorScheme: "light" });
  });

  const nav = (html: string) => html.match(/<nav[^>]*>.*?<\/nav>/)?.[0] ?? "";

  it("gives a guest no main navigation and no bar space in the body", async () => {
    const html = await shell();

    expect(html).not.toContain('aria-label="Główna"');
    expect(html).not.toMatch(/<body class="[^"]*withNav/);
  });

  it("gives a signed-in explorer the main navigation between the header and the content", async () => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.pathname = "/my/collections";

    const html = await shell();

    expect(html).toMatch(/<body class="[^"]*withNav/);
    expect(html).toMatch(
      /<\/header><\/div><nav [^>]*aria-label="Główna"[\s\S]*<\/nav><main id="tresc"/,
    );
    expect(nav(html).match(/<li>/g)).toHaveLength(5);
    for (const label of ["Start", "Moje kolekcje", "Chcę zobaczyć", "Profil", "Aktualności"]) {
      expect(nav(html)).toContain(`>${label}</span>`);
    }
    // Tylko bieżąca pozycja ma aria-current i kropkę akcentu.
    expect(nav(html).match(/aria-current="page"/g)).toHaveLength(1);
    expect(nav(html)).toMatch(/aria-current="page" href="\/my\/collections"/);
    expect(nav(html).match(/navDot/g)).toHaveLength(1);
    expect(nav(html)).not.toContain("data-area");
  });

  it("marks the navigation of the curator panel so the side menu can give way to it", async () => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.pathname = "/curator/collections/new";

    const html = await shell();

    expect(nav(html)).toContain('data-area="curator"');
    expect(nav(html)).not.toContain("aria-current");
  });

  // Characterization of the links of the shell, written before the news entry points (E7-R3)
  // and kept after them: the guest header gained exactly the news link (B4), the signed-in
  // header and the first four items of the bar did not change.
  describe("links of the shell", () => {
    const hrefs = (fragment: string) =>
      [...fragment.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

    it("links the header of a guest to the start page, the news and the login", async () => {
      expect(hrefs(header(await shell()))).toEqual(["/", "/news", "/login", "/login/zaloz-konto"]);
    });

    it.each([
      ["/news", true],
      ["/news/jak-zbierac-miejsca", true],
      ["/", false],
      ["/newsy", false],
    ])("marks the news link of a guest on %s as current: %s", async (pathname, current) => {
      mocks.pathname = pathname;

      const html = header(await shell());

      expect(/aria-current="page" href="\/news"/.test(html)).toBe(current);
    });

    it("gives a signed-in explorer no news link in the header, the bar has it", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.pathname = "/news/jak-zbierac-miejsca";

      const html = await shell();

      expect(hrefs(header(html))).toEqual(["/"]);
      expect(hrefs(nav(html)).at(-1)).toBe("/news");
      expect(nav(html)).toMatch(/aria-current="page" href="\/news"/);
    });

    it("gives an account that has not accepted the terms neither the news link nor the bar", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.termsAccepted = false;

      const html = await shell();

      expect(hrefs(header(html))).toEqual(["/"]);
      expect(html).not.toContain('aria-label="Główna"');
    });

    it("links the header of a signed-in explorer only to the start page (the profile is in the menu)", async () => {
      mocks.getActor.mockResolvedValue(as("user"));

      expect(hrefs(header(await shell()))).toEqual(["/"]);
    });

    it("keeps the first four items of the bar in the order of the screens", async () => {
      mocks.getActor.mockResolvedValue(as("user"));

      expect(hrefs(nav(await shell())).slice(0, 4)).toEqual([
        "/",
        "/my/collections",
        "/my/want-to-see",
        "/my",
      ]);
    });

    it("draws the bar of a signed-in explorer on a public page with the start item current", async () => {
      mocks.getActor.mockResolvedValue(as("user"));
      mocks.pathname = "/collections/demo";

      expect(nav(await shell())).toMatch(/aria-current="page" href="\/"/);
    });
  });

  it("offers the switch to the other theme in the header, also for a guest", async () => {
    expect(header(await shell())).toMatch(
      /<form [^>]+><button [^>]*type="submit"[^>]*value="light"[^>]*>.+Jasny motyw<\/span><\/button><\/form>/,
    );

    mocks.themeCookie = "light";
    expect(header(await shell())).toMatch(/value="dark"[^>]*>.*Nocny motyw/);
  });
});
