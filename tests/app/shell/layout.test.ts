import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getActor: vi.fn(), pathname: "/" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => mocks.pathname,
}));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));

const { default: RootLayout, viewport } = await import("@/app/layout");

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
  mocks.pathname = "/";
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
    expect(header(await shell())).toMatch(/^<a class="[^"]*brand[^"]*" href="\/">Starter<\/a>/);
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

  it("sets the viewport for a phone", () => {
    expect(viewport).toEqual({ width: "device-width", initialScale: 1 });
  });
});
