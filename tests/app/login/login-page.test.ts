import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// D-49 (K-09...K-11): the login page in two steps. The address typed in step 1 comes back from
// a cookie, is masked in the text and never appears in a URL; the password form sits under
// "Logowanie hasłem".
const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  cookie: vi.fn(),
}));

vi.mock("@/app/request-actor", () => ({ getRequestActor: mocks.getActor }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => mocks.cookie(name) }),
}));
vi.mock("@/app/shell/logout-form", () => ({
  LogoutForm: ({ children }: { children: string }) => `<logout>${children}</logout>`,
}));
vi.mock("@/features/identity/infrastructure/demo-accounts", () => ({
  findSeededDemoAccounts: async () => [],
}));

const { default: LoginPage } = await import("@/app/login/page");

const render = async (params: Record<string, string> = {}) =>
  renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(params) }));

beforeEach(() => {
  mocks.getActor.mockReset().mockResolvedValue(null);
  mocks.cookie.mockReset().mockReturnValue(undefined);
});

describe("login page, step 1", () => {
  it("asks only for the address and says that a code will be sent", async () => {
    const html = await render();

    expect(html).toContain("Podaj adres e-mail, a wyślemy Ci kod logowania.");
    expect(html).toContain('action="/api/auth/code/request"');
    expect(html).toContain("Wyślij kod");
    expect(html).not.toContain("Wpisz kod wysłany");
    expect(html).not.toContain("code-verify-code");
  });

  it("keeps the password form under a closed 'Logowanie hasłem'", async () => {
    const html = await render();

    expect(html).toMatch(/<details[^>]*><summary>Logowanie hasłem<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain('action="/api/auth/login"');
  });

  it("opens the password form after a failed password attempt", async () => {
    const html = await render({ error: "invalid_credentials" });

    expect(html).toMatch(/<details[^>]* open/);
    expect(html).toContain("Nieprawidłowy e-mail lub hasło.");
  });

  it("does not open it for an error of the code steps", async () => {
    const html = await render({ error: "invalid_email" });

    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain("Podaj poprawny adres e-mail.");
  });
});

describe("login page, step 2", () => {
  beforeEach(() => {
    mocks.cookie.mockReturnValue({ value: "anna@example.com" });
  });

  it("shows the masked address, the code field, resend and change of address", async () => {
    const html = await render({ kod: "wyslany" });

    expect(html).toContain("Wpisz kod wysłany na adres <strong>a…@example.com</strong>");
    expect(html).toContain('action="/api/auth/code/verify"');
    expect(html).toContain('id="code-verify-code"');
    expect(html).toContain("autofocus");
    expect(html).toContain("Wyślij kod ponownie");
    expect(html).toContain("Zmień adres");
    expect(html).toContain("Jeśli adres jest poprawny, kod jest już w drodze.");
    expect(html).not.toContain("Podaj adres e-mail, a wyślemy");
    expect(html).not.toContain('id="code-request-email"');
  });

  it("puts the address only in hidden fields of the forms, never in the text or a link", async () => {
    const html = await render({ kod: "wyslany" });

    expect(html).not.toContain("anna@example.com</");
    expect(html).not.toMatch(/href="[^"]*anna/);
    expect(
      html.match(/<input type="hidden" name="email" value="anna@example.com"\/>/g),
    ).toHaveLength(2);
  });

  it("stays on step 2 after a wrong code and hides the 'sent' status", async () => {
    const html = await render({ error: "invalid_code" });

    expect(html).toContain("Kod jest nieprawidłowy albo wygasł.");
    expect(html).toContain('id="code-verify-code"');
    expect(html).not.toContain("kod jest już w drodze");
  });

  it("moves the focus to the error and ties the code field to it after a wrong code", async () => {
    const html = await render({ error: "invalid_code" });

    expect(html).toMatch(/<p id="code-error"[^>]*tabindex="-1"[^>]*autofocus/);
    expect(html).toMatch(/<input id="code-verify-code"[^>]*aria-invalid="true"/);
    expect(html).toMatch(
      /<input id="code-verify-code"[^>]*aria-describedby="code-error code-hint"/,
    );
    expect(html).not.toMatch(/<input id="code-verify-code"[^>]*autofocus/);
  });

  it.each(["code_unavailable", "code_too_many_attempts"])(
    "focuses the %s error but does not mark the code field invalid",
    async (error) => {
      const html = await render({ error });

      expect(html).toMatch(/<p id="code-error"[^>]*tabindex="-1"[^>]*autofocus/);
      expect(html).not.toContain("aria-invalid");
      expect(html).toMatch(/<input id="code-verify-code"[^>]*aria-describedby="code-hint"/);
    },
  );

  it("keeps the focus on the code field and does not mark it invalid without an error", async () => {
    const html = await render({ kod: "wyslany" });

    expect(html).toMatch(/<input id="code-verify-code"[^>]*autofocus/);
    expect(html).not.toContain("aria-invalid");
    expect(html).toMatch(
      /<input id="code-verify-code"[^>]*aria-describedby="code-hint code-status"/,
    );
    expect(html).toContain('id="code-status"');
  });

  it("carries the return path through every form", async () => {
    const html = await render({ kod: "wyslany", returnTo: "/my" });

    expect(html.match(/name="returnTo" value="\/my"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("ignores a malformed cookie and shows step 1", async () => {
    mocks.cookie.mockReturnValue({ value: "not an address" });

    expect(await render()).toContain('id="code-request-email"');
  });
});

describe("login page after the address cookie expired", () => {
  it("explains why it is back at step 1 when the code was sent but the cookie is gone", async () => {
    const html = await render({ kod: "wyslany" });

    expect(html).toContain("Minęło zbyt dużo czasu. Podaj adres jeszcze raz");
    expect(html).toContain('id="code-request-email"');
  });

  it("says nothing of the kind on a plain visit", async () => {
    expect(await render()).not.toContain("Minęło zbyt dużo czasu");
  });
});

describe("login page of a signed-in user", () => {
  it("links to the profile without naming the role", async () => {
    mocks.getActor.mockResolvedValue({ id: "x", role: "user" });

    const html = await render();

    expect(html).toContain("Przejdź do profilu");
    expect(html).not.toContain("Twoja rola");
    expect(html).not.toContain("Przejdź do swojego konta");
  });
});
