import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getActor: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: () => ({ getActor: mocks.getActor }),
}));

const { default: HomePage } = await import("@/app/page");

const id = "11111111-1111-4111-8111-111111111111";

type Search = Record<string, string | string[] | undefined>;

async function render(search: Search = {}): Promise<string> {
  return renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getActor.mockReset().mockResolvedValue(null);
});

describe("start page", () => {
  it("offers a guest the login link", async () => {
    const html = await render();

    expect(html).toMatch(/<h1[^>]*>Witaj w aplikacji<\/h1>/);
    expect(html).toMatch(/<a [^>]*href="\/login"[^>]*>Zaloguj się<\/a>/);
    expect(html).not.toMatch(/href="\/my"/);
  });

  it("offers a signed-in user the profile page", async () => {
    mocks.getActor.mockResolvedValue({ id, role: "user" });

    const html = await render();

    expect(html).toMatch(/<a [^>]*href="\/my"[^>]*>Profil<\/a>/);
    expect(html).not.toContain("Zaloguj się");
  });

  it("shows the guest version and logs only the error class when the session lookup fails", async () => {
    mocks.getActor.mockRejectedValue(new Error("auth down: secret-session-id"));

    const html = await render();

    expect(html).toContain("Zaloguj się");
    expect(console.error).toHaveBeenCalledWith("Session lookup failed:", "Error");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret");
  });

  it("confirms a sign-out and a failed sign-out in a status region", async () => {
    expect(await render({ wylogowano: "1" })).toMatch(/role="status"[^>]*>Wylogowano\./);
    expect(await render({ wylogowanie: "blad" })).toMatch(
      /role="status"[^>]*>Nie udało się wylogować\./,
    );
    expect(await render()).not.toContain('role="status"');
  });

  it("confirms a deleted account (E9-5) only for the exact signal", async () => {
    expect(await render({ konto: "usuniete" })).toMatch(
      /role="status"[^>]*>Twoje konto zostało usunięte\./,
    );
    expect(await render({ konto: "inne" })).not.toContain('role="status"');
  });
});
