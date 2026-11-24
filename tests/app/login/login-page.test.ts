import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// D-49 (K-09...K-11): the login page in two steps. The address typed in step 1 comes back from
// a cookie, is masked in the text and never appears in a URL; the password form sits under
// "Logowanie hasłem".
const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  cookie: vi.fn(),
  organizations: vi.fn(),
}));

vi.mock("@/app/request-actor", () => ({ getRequestActor: mocks.getActor }));
vi.mock("@/app/request-organizations", () => ({ getApprovedOrganizations: mocks.organizations }));
vi.mock("@/app/auth-photo-loader", () => ({ loadAuthPhoto: async () => null }));
vi.mock("@/lib/log-failure", () => ({ logFailure: vi.fn() }));
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
const { default: SignupPage } = await import("@/app/login/zaloz-konto/page");

// The pages are thin: they return the async screen element, which is resolved here.
type ScreenElement = {
  type: (props: unknown) => Promise<React.ReactElement>;
  props: unknown;
};

const renderPage = async (
  Page: typeof LoginPage,
  params: Record<string, string>,
): Promise<string> => {
  const element = Page({ searchParams: Promise.resolve(params) }) as unknown as ScreenElement;

  return renderToStaticMarkup(await element.type(element.props));
};

const render = (params: Record<string, string> = {}) => renderPage(LoginPage, params);

const renderSignup = (params: Record<string, string> = {}) => renderPage(SignupPage, params);

beforeEach(() => {
  mocks.getActor.mockReset().mockResolvedValue(null);
  mocks.cookie.mockReset().mockReturnValue(undefined);
  mocks.organizations.mockReset().mockResolvedValue([]);
});

describe("login page, step 1", () => {
  it("asks only for the address and says that a code will be sent", async () => {
    const html = await render();

    expect(html).toContain("<h1>Zaloguj się</h1>");
    expect(html).toContain("Podaj adres e-mail konta. Wyślemy na niego kod.");
    expect(html).toContain('action="/api/auth/code/request"');
    expect(html).toContain("Wyślij kod");
    expect(html).not.toContain("Kod wysłaliśmy");
    expect(html).not.toContain("code-verify-code");
  });

  it("no longer mentions the terms on the screen (they are accepted in the next step)", async () => {
    const html = await render();

    expect(html).not.toContain("regulamin");
    expect(html).not.toContain("Regulamin");
  });

  it("links to the other entrance and keeps the return path in that link", async () => {
    expect(await render()).toMatch(
      /Nie masz konta\? <a class="[^"]*" href="\/login\/zaloz-konto">Załóż konto<\/a>/,
    );
    expect(await render({ returnTo: "/places/1" })).toContain(
      'href="/login/zaloz-konto?returnTo=%2Fplaces%2F1"',
    );
  });

  it("tells the forms which entrance they came from", async () => {
    expect(await render()).toContain('<input type="hidden" name="entry" value="login"/>');
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

    expect(html).toContain("<h1>Wpisz kod z wiadomości</h1>");
    expect(html).toMatch(/Kod wysłaliśmy na adres <strong[^>]*>a…@example\.com<\/strong>/);
    expect(html).toContain('action="/api/auth/code/verify"');
    expect(html).toContain('id="code-verify-code"');
    expect(html).toContain("autofocus");
    expect(html).toContain("Wyślij kod ponownie");
    expect(html).toContain("Zmień adres");
    expect(html).toContain("Jeśli adres jest poprawny, kod jest już w drodze.");
    expect(html).not.toContain("Podaj adres e-mail konta");
    expect(html).not.toContain('id="code-request-email"');
    expect(html).toMatch(/>Zaloguj się<\/button><\/form><div/);
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

describe("signup page (Załóż konto): the same mechanism, its own texts", () => {
  it("has its own heading and text, the same forms and a link back to the login", async () => {
    const html = await renderSignup();

    expect(html).toContain("<h1>Załóż konto</h1>");
    expect(html).toContain("Hasła nie potrzebujesz.");
    expect(html).toContain('action="/api/auth/code/request"');
    expect(html).toContain('<input type="hidden" name="entry" value="signup"/>');
    expect(html).toMatch(/Masz już konto\? <a class="[^"]*" href="\/login">Zaloguj się<\/a>/);
    expect(html).not.toContain("Regulamin");
  });

  it("has no password form and no demo accounts", async () => {
    const html = await renderSignup();

    expect(html).not.toContain("Logowanie hasłem");
    expect(html).not.toContain('action="/api/auth/login"');
  });

  it("names the second step's button after the entrance", async () => {
    mocks.cookie.mockReturnValue({ value: "anna@example.com" });

    const html = await renderSignup({ kod: "wyslany" });

    expect(html).toContain("<h1>Wpisz kod z wiadomości</h1>");
    expect(html).toMatch(/>Załóż konto<\/button><\/form><div/);
    expect(html).toContain('<input type="hidden" name="entry" value="signup"/>');
  });

  it("keeps the return path in the link to the login", async () => {
    expect(await renderSignup({ returnTo: "/places/1" })).toContain(
      'href="/login?returnTo=%2Fplaces%2F1"',
    );
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

    expect(html).toContain('href="/my"');
    expect(html).toContain("Przejdź do profilu");
    expect(html).not.toContain("Przejdź do panelu kuratora");
    expect(html).not.toContain("Twoja rola");
    expect(html).not.toContain("Przejdź do swojego konta");
  });

  it("links a curator to the panel", async () => {
    mocks.getActor.mockResolvedValue({ id: "x", role: "user" });
    mocks.organizations.mockResolvedValue([{ name: "Muzeum" }]);

    const html = await render();

    expect(html).toContain('href="/curator"');
    expect(html).toContain("Przejdź do panelu kuratora");
    expect(html).not.toContain("Przejdź do profilu");
  });

  it("falls back to the profile when the organizations cannot be read", async () => {
    mocks.getActor.mockResolvedValue({ id: "x", role: "user" });
    mocks.organizations.mockRejectedValue(new Error("db down"));

    const html = await render();

    expect(html).toContain('href="/my"');
    expect(html).toContain("Przejdź do profilu");
  });
});
