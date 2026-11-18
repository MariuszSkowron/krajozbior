import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  themeCookie: undefined as string | undefined,
  getActor: vi.fn(),
  listMemberships: vi.fn(),
  pathname: "/",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
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
}));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));

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
  mocks.pathname = "/";
  mocks.themeCookie = undefined;
});

describe("app shell", () => {
  it("puts the skip link first, then the header and the main content", async () => {
    const html = await shell();
    const body = html.match(/<body[^>]*>(.*)<\/body>/)?.[1] ?? "";

    expect(body).toMatch(
      /^<a class="[^"]*skipLink[^"]*" href="#tresc">Przejdź do treści<\/a><header/,
    );
    expect(body).toMatch(
      /<\/header><main id="tresc" tabindex="-1"[^>]*><p>Treść strony<\/p><\/main>/,
    );
    expect(html.match(/<main/g)).toHaveLength(1);
  });

  it("links the application name to the start page", async () => {
    expect(header(await shell())).toMatch(/^<a class="[^"]*brand[^"]*" href="\/">Krajozbiór<\/a>/);
  });

  it("gives a guest a login link back to the current page", async () => {
    mocks.pathname = "/my";

    const html = await shell();

    expect(header(html)).toContain('href="/login?returnTo=%2Fmy">Zaloguj się</a>');
    expect(html).not.toContain("Wyloguj");
  });

  it.each([
    ["user", "Użytkownik"],
    ["admin", "Administrator"],
  ] as const)("gives %s the role and a logout form", async (role, label) => {
    mocks.getActor.mockResolvedValue(as(role));

    const html = await shell();

    expect(header(html)).toContain(`Twoja rola: </span>${label}`);
    expect(header(html)).toMatch(
      /<form action="\/api\/auth\/logout" method="post"><button [^>]*type="submit">Wyloguj<\/button><\/form>/,
    );
    expect(html).not.toContain("Zaloguj się");
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

    expect(header(await shell())).toContain('href="/curator">Panel kuratora</a>');
  });

  it.each([
    ["has no organization", []],
    ["has only a suspended organization", [organization("suspended")]],
  ])("shows no panel link for an account that %s", async (_name, memberships) => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.listMemberships.mockResolvedValue(memberships);

    expect(await shell()).not.toContain("Panel kuratora");
  });

  it("shows no panel link to a guest and does not look organizations up", async () => {
    expect(await shell()).not.toContain("Panel kuratora");
    expect(mocks.listMemberships).not.toHaveBeenCalled();
  });

  it("draws the shell without the link and logs the error class when the lookup fails", async () => {
    mocks.getActor.mockResolvedValue(as("user"));
    mocks.listMemberships.mockRejectedValue(new Error("db down: secret"));

    const html = await shell();

    expect(html).not.toContain("Panel kuratora");
    expect(html).toContain("Wyloguj");
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

  it("offers the switch to the other theme in the header, also for a guest", async () => {
    expect(header(await shell())).toMatch(
      /<form [^>]+><button [^>]*type="submit"[^>]*value="light"[^>]*>.+Jasny motyw<\/span><\/button><\/form>/,
    );

    mocks.themeCookie = "light";
    expect(header(await shell())).toMatch(/value="dark"[^>]*>.*Nocny motyw/);
  });
});
