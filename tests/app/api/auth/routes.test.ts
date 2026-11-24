import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IdentityProvider } from "@/features/identity/domain/identity-provider";

const provider = vi.hoisted(() => ({
  getActor: vi.fn(),
  signIn: vi.fn(),
  requestSignInCode: vi.fn(),
  signInWithCode: vi.fn(),
  signOut: vi.fn(),
  getSessionCreatedAt: vi.fn(),
  deleteAccount: vi.fn(),
}));

const throttle = vi.hoisted(() => ({
  reserve: vi.fn(),
  clearAccount: vi.fn(),
}));

const codeThrottle = vi.hoisted(() => ({
  reserve: vi.fn(),
  clearAccount: vi.fn(),
}));

const otpLimiter = vi.hoisted(() => ({ reserve: vi.fn() }));

const cleanup = vi.hoisted(() => vi.fn());

const ipHeader = vi.hoisted(() => ({ value: undefined as string | undefined }));

// The theme saved on the account (E9-4): a use case over a fake repository.
const settings = vi.hoisted(() => ({ readTheme: vi.fn() }));

vi.mock("@/features/settings/infrastructure/settings-deps", () => ({
  getSettingsDeps: () => ({
    withUserContext: async (_actor: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    repository: { readTheme: settings.readTheme, saveTheme: vi.fn() },
  }),
}));

// The organizations of the account that just signed in (paczka N, faza 2): the real use case
// over a fake reader, so the actor passed to it is checked too.
const memberships = vi.hoisted(() => ({ list: vi.fn(), withUserContext: vi.fn() }));
const failures = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock("@/features/organizations/infrastructure/postgres-organization-reader", () => ({
  listMyOrganizationsDeps: {
    withUserContext: memberships.withUserContext,
    listMemberships: memberships.list,
  },
}));

// What the account that just signed in already has (the start page has nothing of theirs yet for
// an account without a visit and a saved collection) : the real
// use cases over fake repositories.
const album = vi.hoisted(() => ({ summary: vi.fn(), favorites: vi.fn(), recent: vi.fn() }));

vi.mock("@/features/album/infrastructure/album-deps", () => ({
  getAlbumDeps: () => ({
    withUserContext: async (_actor: unknown, work: (tx: unknown) => Promise<unknown>) => work({}),
    repository: {
      homeSummary: album.summary,
      homeFavorites: album.favorites,
      homeRecentVisits: album.recent,
    },
  }),
}));

vi.mock("@/lib/log-failure", () => ({ logFailure: failures.log }));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: (): IdentityProvider => provider,
  getSignInThrottle: () => throttle,
  getCodeVerifyThrottle: () => codeThrottle,
  getOtpSendLimiter: () => otpLimiter,
  cleanupExpiredSessions: () => cleanup(),
  getClientIpHeader: () => ipHeader.value,
}));

const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: requestCode } = await import("@/app/api/auth/code/request/route");
const { POST: verifyCode } = await import("@/app/api/auth/code/verify/route");

function jsonPost(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// A production deployment without the test flag (isDemoSignInAllowed).
function inProduction(run: () => Promise<void>) {
  return async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_ACCOUNTS_TEST_ONLY", "");
    try {
      await run();
    } finally {
      vi.unstubAllEnvs();
    }
  };
}

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "admin" } as const;

function formLogin(fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

function jsonLogin(body: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

beforeEach(() => {
  provider.signIn.mockReset();
  provider.signOut.mockReset();
  throttle.reserve.mockReset().mockResolvedValue({ allowed: true });
  throttle.clearAccount.mockReset().mockResolvedValue(undefined);
  codeThrottle.reserve.mockReset().mockResolvedValue({ allowed: true });
  codeThrottle.clearAccount.mockReset().mockResolvedValue(undefined);
  otpLimiter.reserve.mockReset().mockResolvedValue({ allowed: true });
  provider.requestSignInCode.mockReset().mockResolvedValue(undefined);
  provider.signInWithCode.mockReset();
  cleanup.mockReset().mockResolvedValue(undefined);
  settings.readTheme.mockReset().mockResolvedValue(null);
  memberships.list.mockReset().mockResolvedValue([]);
  memberships.withUserContext
    .mockReset()
    .mockImplementation(async (_actor: unknown, work: (tx: unknown) => Promise<unknown>) =>
      work({}),
    );
  failures.log.mockReset();
  // By default the account has something in its album and accepted the terms.
  album.summary
    .mockReset()
    .mockResolvedValue({ discoveredPlaces: 1, regions: 1, savedCollections: 1 });
  album.favorites.mockReset().mockResolvedValue([]);
  album.recent.mockReset().mockResolvedValue([]);
});

// The address kept for the code sign-in is dropped by every sign-in and by sign-out (S-3).
const clearedAddress = expect.stringMatching(/^krajozbior_login_email=; Path=\/login; Max-Age=0;/);

describe("the theme saved on the account after sign-in (E9-4)", () => {
  const session = "krajozbior.session_token=a; HttpOnly";

  it("adds the cookie of the saved theme to a password sign-in", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: [session] });
    provider.signOut.mockResolvedValue([]);
    settings.readTheme.mockResolvedValue("light");

    const response = await login(jsonLogin(JSON.stringify({ email: "a@b.test", password: "pw" })));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      session,
      expect.stringMatching(
        /^krajozbior-theme=light; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Lax/,
      ),
      clearedAddress,
    ]);
  });

  it("adds it to a sign-in with a code as well", async () => {
    provider.signInWithCode.mockResolvedValue({ actor, setCookies: [session] });
    provider.signOut.mockResolvedValue([]);
    settings.readTheme.mockResolvedValue("dark");

    const response = await verifyCode(
      jsonPost("/api/auth/code/verify", { email: "a@b.test", code: "123456" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      session,
      expect.stringMatching(/^krajozbior-theme=dark;/),
      expect.stringMatching(/^krajozbior_login_email=; Path=\/login; Max-Age=0;/),
    ]);
  });

  it("leaves the cookie of the browser when the account never chose a theme", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: [session] });
    provider.signOut.mockResolvedValue([]);

    const response = await login(jsonLogin(JSON.stringify({ email: "a@b.test", password: "pw" })));

    expect(response.headers.getSetCookie()).toEqual([session, clearedAddress]);
  });

  it("does not block the sign-in when the theme cannot be read", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: [session] });
    provider.signOut.mockResolvedValue([]);
    settings.readTheme.mockRejectedValue(new Error("database down"));

    const response = await login(jsonLogin(JSON.stringify({ email: "a@b.test", password: "pw" })));

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([session, clearedAddress]);
  });
});

describe("the address kept between the two steps of the code sign-in (D-49)", () => {
  function formRequest(email: string) {
    return new Request("http://localhost/api/auth/code/request", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: ` ${email.toUpperCase()} ` }),
    });
  }

  it("goes in a short-lived cookie, never in the redirect URL", async () => {
    const response = await requestCode(formRequest("anna@example.com"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?kod=wyslany");
    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(
        /^krajozbior_login_email=anna%40example\.com; Path=\/login; Max-Age=600; HttpOnly; SameSite=Lax/,
      ),
    ]);
  });

  it("is set for a demo address on production too, so the answer reveals nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEMO_ACCOUNTS_TEST_ONLY", "");

    try {
      const response = await requestCode(formRequest("user@demo.krajozbior.local"));

      expect(response.status).toBe(303);
      expect(response.headers.getSetCookie()).toHaveLength(1);
      expect(provider.requestSignInCode).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is not set when the request is refused by a limit or the address is malformed", async () => {
    otpLimiter.reserve.mockResolvedValue({ allowed: false, reason: "rate", retryAfterSeconds: 60 });

    expect((await requestCode(formRequest("anna@example.com"))).headers.getSetCookie()).toEqual([]);
    expect((await requestCode(formRequest("not-an-address"))).headers.getSetCookie()).toEqual([]);
  });

  it("is not set for a JSON client", async () => {
    const response = await requestCode(
      jsonPost("/api/auth/code/request", { email: "anna@example.com" }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

// Two entrances ("Zaloguj się", "Załóż konto") share the routes; the form says which one it came
// from, and only the page the person returns to (and one explanation) differs.
describe("the two entrances to the code sign-in", () => {
  const user = { id: "22222222-2222-4222-8222-222222222222", role: "user" } as const;

  function form(path: string, fields: Record<string, string>) {
    return new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    });
  }

  it("returns step 1 to the signup page when the form came from it, with the same answer", async () => {
    const signup = await requestCode(
      form("/api/auth/code/request", { email: "anna@example.com", entry: "signup" }),
    );
    const login = await requestCode(
      form("/api/auth/code/request", { email: "anna@example.com", entry: "login" }),
    );
    const none = await requestCode(form("/api/auth/code/request", { email: "anna@example.com" }));

    expect(signup.headers.get("location")).toBe("/login/zaloz-konto?kod=wyslany");
    expect(login.headers.get("location")).toBe("/login?kod=wyslany");
    expect(none.headers.get("location")).toBe("/login?kod=wyslany");
    expect(signup.headers.getSetCookie()).toEqual(login.headers.getSetCookie());
  });

  it("sends the errors of every step back to the entrance the form came from", async () => {
    const malformed = await requestCode(
      form("/api/auth/code/request", { email: "nope", entry: "signup", returnTo: "/my" }),
    );

    otpLimiter.reserve.mockResolvedValue({ allowed: false, reason: "rate", retryAfterSeconds: 5 });

    const limited = await requestCode(
      form("/api/auth/code/request", { email: "anna@example.com", entry: "signup" }),
    );

    provider.signInWithCode.mockResolvedValue(null);

    const wrongCode = await verifyCode(
      form("/api/auth/code/verify", { email: "anna@example.com", code: "123456", entry: "signup" }),
    );
    const wrongCodeLogin = await verifyCode(
      form("/api/auth/code/verify", { email: "anna@example.com", code: "123456", entry: "login" }),
    );

    expect(malformed.headers.get("location")).toBe(
      "/login/zaloz-konto?error=invalid_email&returnTo=%2Fmy",
    );
    expect(limited.headers.get("location")).toBe("/login/zaloz-konto?error=code_too_many_attempts");
    expect(wrongCode.headers.get("location")).toBe("/login/zaloz-konto?error=invalid_code");
    expect(wrongCodeLogin.headers.get("location")).toBe("/login?error=invalid_code");
  });

  it("explains the new account only after the code, only for the login entrance", async () => {
    provider.signInWithCode.mockResolvedValue({
      actor: user,
      setCookies: [],
      accountCreated: true,
    });
    provider.signOut.mockResolvedValue([]);
    album.summary.mockResolvedValue({ discoveredPlaces: 0, regions: 0, savedCollections: 0 });

    const fromLogin = await verifyCode(
      form("/api/auth/code/verify", { email: "anna@example.com", code: "123456", entry: "login" }),
    );
    const fromSignup = await verifyCode(
      form("/api/auth/code/verify", { email: "anna@example.com", code: "123456", entry: "signup" }),
    );
    const json = await verifyCode(
      jsonPost("/api/auth/code/verify", { email: "anna@example.com", code: "123456" }),
    );

    expect(fromLogin.headers.get("location")).toBe("/?wejscie=logowanie");
    expect(fromSignup.headers.get("location")).toBe("/");
    expect(await json.json()).toEqual({ role: "user", returnTo: "/" });
  });

  it("keeps the mark next to a returnTo with a query", async () => {
    provider.signInWithCode.mockResolvedValue({
      actor: user,
      setCookies: [],
      accountCreated: true,
    });
    provider.signOut.mockResolvedValue([]);

    const created = await verifyCode(
      form("/api/auth/code/verify", {
        email: "anna@example.com",
        code: "123456",
        entry: "login",
        returnTo: "/places/1?a=b",
      }),
    );

    expect(created.headers.get("location")).toBe("/places/1?a=b&wejscie=logowanie");
  });

  it("says nothing to an existing account, whatever terms it accepted (S-1)", async () => {
    provider.signOut.mockResolvedValue([]);

    // An existing account (not created by this sign-in), also when it has not accepted the
    // current terms (declined earlier or the terms changed): no "we created an account".
    for (const accountCreated of [false, undefined]) {
      provider.signInWithCode.mockResolvedValue({ actor: user, setCookies: [], accountCreated });

      const existing = await verifyCode(
        form("/api/auth/code/verify", {
          email: "anna@example.com",
          code: "123456",
          entry: "login",
        }),
      );

      expect(existing.headers.get("location")).toBe("/my");
    }
  });
});

describe("POST /api/auth/code/request limits", () => {
  it("counts the request in the code limits, never in the password sign-in limits", async () => {
    const response = await requestCode(
      jsonPost("/api/auth/code/request", { email: "Admin@Example.test" }),
    );

    expect(response.status).toBe(202);
    expect(otpLimiter.reserve).toHaveBeenCalledWith({ email: "admin@example.test", ip: null });
    expect(throttle.reserve).not.toHaveBeenCalled();
    expect(provider.requestSignInCode).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("cleans expired sessions only for a request that passed the limits", async () => {
    otpLimiter.reserve.mockResolvedValue({ allowed: false, reason: "rate", retryAfterSeconds: 60 });

    await requestCode(jsonPost("/api/auth/code/request", { email: "a@b.test" }));

    expect(cleanup).not.toHaveBeenCalled();
  });

  it("answers 429 with Retry-After at a limit of the address or IP and sends nothing", async () => {
    otpLimiter.reserve.mockResolvedValue({ allowed: false, reason: "rate", retryAfterSeconds: 60 });

    const response = await requestCode(jsonPost("/api/auth/code/request", { email: "a@b.test" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "code_too_many_attempts" });
    expect(provider.requestSignInCode).not.toHaveBeenCalled();
  });

  it("answers 503 to everybody once the global daily limit is reached", async () => {
    otpLimiter.reserve.mockResolvedValue({
      allowed: false,
      reason: "global",
      retryAfterSeconds: 3600,
    });

    const response = await requestCode(jsonPost("/api/auth/code/request", { email: "a@b.test" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "code_unavailable" });
    expect(provider.requestSignInCode).not.toHaveBeenCalled();
  });

  it("reports a limiter failure as unavailable", async () => {
    otpLimiter.reserve.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await requestCode(jsonPost("/api/auth/code/request", { email: "a@b.test" }));

    expect(response.status).toBe(503);
    vi.restoreAllMocks();
  });

  it("checks codes against their own counters, apart from password sign-in", async () => {
    provider.signInWithCode.mockResolvedValue(null);

    const response = await verifyCode(
      jsonPost("/api/auth/code/verify", { email: "a@b.test", code: "123456" }),
    );

    expect(response.status).toBe(401);
    expect(codeThrottle.reserve).toHaveBeenCalledOnce();
    expect(throttle.reserve).not.toHaveBeenCalled();
  });
});

describe("demo accounts on a production deployment", () => {
  it(
    "refuses the password sign-in of a demo account like wrong credentials",
    inProduction(async () => {
      const response = await login(
        jsonPost("/api/auth/login", { email: "admin@demo.krajozbior.local", password: "x" }),
      );

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_credentials" });
      expect(throttle.reserve).not.toHaveBeenCalled();
      expect(provider.signIn).not.toHaveBeenCalled();
    }),
  );

  it(
    "answers a code request for a demo address as sent, but counts and sends nothing",
    inProduction(async () => {
      const response = await requestCode(
        jsonPost("/api/auth/code/request", { email: "user@demo.krajozbior.local" }),
      );

      expect(response.status).toBe(202);
      expect(otpLimiter.reserve).not.toHaveBeenCalled();
      expect(provider.requestSignInCode).not.toHaveBeenCalled();
    }),
  );

  it(
    "refuses a code check for a demo address",
    inProduction(async () => {
      const response = await verifyCode(
        jsonPost("/api/auth/code/verify", { email: "user@demo.krajozbior.local", code: "123456" }),
      );

      expect(response.status).toBe(401);
      expect(provider.signInWithCode).not.toHaveBeenCalled();
    }),
  );

  it(
    "still signs in an ordinary account in production",
    inProduction(async () => {
      provider.signIn.mockResolvedValue(null);

      await login(jsonPost("/api/auth/login", { email: "jan@example.test", password: "x" }));

      expect(provider.signIn).toHaveBeenCalledOnce();
    }),
  );
});

describe("POST /api/auth/login sign-in limit (issue #39)", () => {
  it("answers 429 with Retry-After and never checks the password", async () => {
    throttle.reserve.mockResolvedValue({ allowed: false, retryAfterSeconds: 120 });

    const response = await login(
      jsonLogin(JSON.stringify({ email: "a@example.test", password: "x" })),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(await response.json()).toEqual({ error: "too_many_attempts" });
    expect(provider.signIn).not.toHaveBeenCalled();
  });

  it("does not count malformed input as an attempt", async () => {
    const response = await login(jsonLogin(JSON.stringify({ email: "", password: "" })));

    expect(response.status).toBe(401);
    expect(throttle.reserve).not.toHaveBeenCalled();
  });

  it("clears the account counters only after a successful sign-in", async () => {
    provider.signIn.mockResolvedValueOnce(null);
    await login(jsonLogin(JSON.stringify({ email: "a@example.test", password: "x" })));
    expect(throttle.clearAccount).not.toHaveBeenCalled();

    provider.signIn.mockResolvedValueOnce({ actor, setCookies: [] });
    provider.signOut.mockResolvedValueOnce([]);
    await login(jsonLogin(JSON.stringify({ email: "a@example.test", password: "x" })));
    expect(throttle.clearAccount).toHaveBeenCalledWith({ email: "a@example.test", ip: null });
  });

  it("counts the configured client address and warns when the proxy did not send it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const body = JSON.stringify({ email: "a@example.test", password: "x" });
    ipHeader.value = "x-real-ip";

    try {
      await login(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", "x-real-ip": "203.0.113.7" },
          body,
        }),
      );
      expect(throttle.reserve).toHaveBeenLastCalledWith({
        email: "a@example.test",
        ip: "203.0.113.7",
      });
      expect(warn).not.toHaveBeenCalled();

      await login(jsonLogin(body));
      expect(throttle.reserve).toHaveBeenLastCalledWith({ email: "a@example.test", ip: null });
      expect(warn).toHaveBeenCalledWith(
        JSON.stringify({ event: "auth.client_ip_missing", header: "x-real-ip" }),
      );
    } finally {
      ipHeader.value = undefined;
      warn.mockRestore();
    }
  });

  it("reports a limiter failure as unavailable", async () => {
    throttle.reserve.mockRejectedValue(new Error("db down"));

    const response = await login(
      jsonLogin(JSON.stringify({ email: "a@example.test", password: "x" })),
    );

    expect(response.status).toBe(503);
    expect(provider.signIn).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/login", () => {
  it("sets the session cookies and redirects a form post to a safe returnTo", async () => {
    provider.signIn.mockResolvedValue({
      actor,
      setCookies: ["krajozbior.session_token=a; HttpOnly"],
    });

    const response = await login(
      formLogin({
        email: "admin@demo.krajozbior.local",
        password: "pw",
        returnTo: "/api/admin",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/api/admin");
    // Also the address kept for the code sign-in is dropped (S-3).
    expect(response.headers.getSetCookie()).toEqual([
      "krajozbior.session_token=a; HttpOnly",
      clearedAddress,
    ]);
  });

  it("never redirects off-site, whatever returnTo says", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: [] });

    const response = await login(
      formLogin({ email: "a@b.c", password: "pw", returnTo: "https://evil.example" }),
    );

    expect(response.headers.get("Location")).toBe("/");
  });

  it("answers a JSON login with the role and the safe returnTo", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: [] });

    const response = await login(jsonLogin('{"email":"a@b.c","password":"pw","returnTo":"//x"}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "admin", returnTo: "/" });
  });

  it("sends a role without returnTo to its home page", async () => {
    provider.signIn.mockResolvedValue({ actor: { ...actor, role: "admin" }, setCookies: [] });

    const form = await login(formLogin({ email: "a@b.c", password: "pw" }));
    const emptyReturnTo = await login(formLogin({ email: "a@b.c", password: "pw", returnTo: "" }));
    const json = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

    expect(form.headers.get("Location")).toBe("/my");
    expect(emptyReturnTo.headers.get("Location")).toBe("/my");
    expect(await json.json()).toEqual({ role: "admin", returnTo: "/my" });
  });

  describe("destination of a curator (paczka N, faza 2)", () => {
    const user = { id: "22222222-2222-4222-8222-222222222222", role: "user" } as const;
    const organization = (status: "approved" | "suspended") => ({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Muzeum",
      slug: "muzeum",
      kind: "museum",
      status,
    });

    it("sends an account with an approved organization to the panel, without returnTo", async () => {
      provider.signIn.mockResolvedValue({ actor: user, setCookies: [] });
      memberships.list.mockResolvedValue([organization("approved")]);

      const form = await login(formLogin({ email: "a@b.c", password: "pw" }));
      const json = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

      expect(form.status).toBe(303);
      expect(form.headers.get("Location")).toBe("/curator");
      expect(await json.json()).toEqual({ role: "user", returnTo: "/curator" });
      // The actor is the one of the sign-in result, never one from the request.
      expect(memberships.withUserContext).toHaveBeenCalledWith(user, expect.any(Function));
    });

    it("sends the same curator after a sign-in with a code", async () => {
      provider.signInWithCode.mockResolvedValue({ actor: user, setCookies: [] });
      provider.signOut.mockResolvedValue([]);
      memberships.list.mockResolvedValue([organization("approved")]);

      const response = await verifyCode(
        jsonPost("/api/auth/code/verify", { email: "a@b.test", code: "123456" }),
      );

      expect(await response.json()).toEqual({ role: "user", returnTo: "/curator" });
    });

    it("keeps an explicit returnTo, also for a curator", async () => {
      provider.signIn.mockResolvedValue({ actor: user, setCookies: [] });
      memberships.list.mockResolvedValue([organization("approved")]);

      const response = await login(
        formLogin({ email: "a@b.c", password: "pw", returnTo: "/collections/x" }),
      );

      expect(response.headers.get("Location")).toBe("/collections/x");
    });

    it("sends a suspended organization and an account without one to the account view", async () => {
      provider.signIn.mockResolvedValue({ actor: user, setCookies: [] });
      memberships.list.mockResolvedValue([organization("suspended")]);

      const suspended = await login(formLogin({ email: "a@b.c", password: "pw" }));

      memberships.list.mockResolvedValue([]);

      const none = await login(formLogin({ email: "a@b.c", password: "pw" }));

      expect(suspended.headers.get("Location")).toBe("/my");
      expect(none.headers.get("Location")).toBe("/my");
    });

    it("signs in anyway and logs when the membership cannot be read", async () => {
      provider.signIn.mockResolvedValue({ actor: user, setCookies: ["s=1"] });
      memberships.list.mockRejectedValue(new Error("db down"));

      const form = await login(formLogin({ email: "a@b.c", password: "pw" }));
      const json = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

      expect(form.status).toBe(303);
      expect(form.headers.get("Location")).toBe("/my");
      expect(form.headers.getSetCookie()).toContain("s=1");
      expect(await json.json()).toEqual({ role: "user", returnTo: "/my" });
      expect(failures.log).toHaveBeenCalledWith("Sign-in destination", expect.any(Error));
    });
  });

  describe("destination of an account with no visit and no saved collection (Pierwszy kontakt)", () => {
    const user = { id: "22222222-2222-4222-8222-222222222222", role: "user" } as const;
    const noAlbumYet = { discoveredPlaces: 0, regions: 0, savedCollections: 0 };

    it("sends an explorer and an administrator to the start page, without returnTo", async () => {
      album.summary.mockResolvedValue(noAlbumYet);
      provider.signIn.mockResolvedValue({ actor: user, setCookies: [] });

      const explorer = await login(formLogin({ email: "a@b.c", password: "pw" }));

      provider.signIn.mockResolvedValue({ actor, setCookies: [] });

      const admin = await login(formLogin({ email: "a@b.c", password: "pw" }));
      const json = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

      expect(explorer.headers.get("Location")).toBe("/");
      expect(admin.headers.get("Location")).toBe("/");
      expect(await json.json()).toEqual({ role: "admin", returnTo: "/" });
      expect(provider.signIn).toHaveBeenCalledTimes(3);
    });

    it("keeps everyone with a visit or a saved collection on the account view", async () => {
      provider.signIn.mockResolvedValue({ actor: user, setCookies: [] });

      for (const summary of [
        { discoveredPlaces: 1, regions: 1, savedCollections: 0 },
        { discoveredPlaces: 0, regions: 0, savedCollections: 1 },
      ]) {
        album.summary.mockResolvedValue(summary);

        const response = await login(formLogin({ email: "a@b.c", password: "pw" }));

        expect(response.headers.get("Location")).toBe("/my");
      }
    });

    it("keeps an explicit returnTo and sends a curator to the panel", async () => {
      album.summary.mockResolvedValue(noAlbumYet);
      provider.signIn.mockResolvedValue({ actor: user, setCookies: [] });

      const withReturn = await login(
        formLogin({ email: "a@b.c", password: "pw", returnTo: "/collections/x" }),
      );

      memberships.list.mockResolvedValue([
        { id: "3", name: "Muzeum", slug: "muzeum", kind: "museum", status: "approved" },
      ]);

      const curator = await login(formLogin({ email: "a@b.c", password: "pw" }));

      expect(withReturn.headers.get("Location")).toBe("/collections/x");
      expect(curator.headers.get("Location")).toBe("/curator");
      // The album is read only when it decides the page.
      expect(album.summary).toHaveBeenCalledTimes(0);
    });

    it("lands on the account view and logs when the album cannot be read", async () => {
      album.summary.mockRejectedValue(new Error("db down"));
      provider.signIn.mockResolvedValue({ actor: user, setCookies: ["s=1"] });

      const response = await login(formLogin({ email: "a@b.c", password: "pw" }));

      expect(response.status).toBe(303);
      expect(response.headers.get("Location")).toBe("/my");
      expect(response.headers.getSetCookie()).toContain("s=1");
      expect(failures.log).toHaveBeenCalledWith("Sign-in destination (album)", expect.any(Error));
    });

    it("sends a new account after a code sign-in to the start page", async () => {
      album.summary.mockResolvedValue(noAlbumYet);
      provider.signInWithCode.mockResolvedValue({ actor: user, setCookies: [] });
      provider.signOut.mockResolvedValue([]);

      const response = await verifyCode(
        jsonPost("/api/auth/code/verify", { email: "a@b.test", code: "123456" }),
      );

      expect(await response.json()).toEqual({ role: "user", returnTo: "/" });
      // S-2: the page after signing in needs the counts only, not the favourites and visits.
      expect(album.summary).toHaveBeenCalledTimes(1);
      expect(album.favorites).not.toHaveBeenCalled();
      expect(album.recent).not.toHaveBeenCalled();
    });
  });

  it("revokes the session the browser already had after a successful login", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: ["krajozbior.session_token=new"] });
    provider.signOut.mockResolvedValue(["krajozbior.session_token=; Max-Age=0"]);

    const request = jsonLogin('{"email":"a@b.c","password":"pw"}');
    const response = await login(request);

    expect(provider.signOut).toHaveBeenCalledWith(request.headers);
    // Only the new session cookie goes back (the clearing cookie of the old session would drop
    // it), plus the clearing of the address kept for the code sign-in.
    expect(response.headers.getSetCookie()).toEqual([
      "krajozbior.session_token=new",
      clearedAddress,
    ]);
  });

  it("keeps the current session when the login fails", async () => {
    provider.signIn.mockResolvedValue(null);

    await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

    expect(provider.signOut).not.toHaveBeenCalled();
  });

  it("reports a failed revocation of the previous session as retryable", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: ["krajozbior.session_token=new"] });
    provider.signOut.mockRejectedValue(new Error("Session is still active after sign-out"));

    const response = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("prefers an explicit returnTo over the role home page", async () => {
    provider.signIn.mockResolvedValue({ actor: { ...actor, role: "admin" }, setCookies: [] });

    const response = await login(
      formLogin({ email: "a@b.c", password: "pw", returnTo: "/api/demo/personal" }),
    );

    expect(response.headers.get("Location")).toBe("/api/demo/personal");
  });

  it("returns the same generic error for wrong credentials and malformed input", async () => {
    provider.signIn.mockResolvedValue(null);

    const wrong = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));
    const malformed = await login(jsonLogin('{"email":"","password":""}'));

    expect(wrong.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "invalid_credentials" });
    expect(await malformed.json()).toEqual({ error: "invalid_credentials" });
    expect(provider.signIn).toHaveBeenCalledTimes(1);
  });

  it("sends a failed form login back to the form without echoing the account", async () => {
    provider.signIn.mockResolvedValue(null);

    const response = await login(
      formLogin({ email: "a@b.c", password: "pw", returnTo: "/api/demo/personal" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(
      "/login?error=invalid_credentials&returnTo=%2Fapi%2Fdemo%2Fpersonal",
    );
  });

  it("does not invent a returnTo for a failed form login without one", async () => {
    provider.signIn.mockResolvedValue(null);

    const response = await login(formLogin({ email: "a@b.c", password: "pw" }));

    expect(response.headers.get("Location")).toBe("/login?error=invalid_credentials");
  });

  it("rejects an unreadable or non-object JSON body", async () => {
    expect((await login(jsonLogin("not json"))).status).toBe(400);

    const arrayBody = await login(jsonLogin("[1]"));
    expect(arrayBody.status).toBe(401);
  });

  it("reports provider failure as retryable without a session", async () => {
    provider.signIn.mockRejectedValue(new Error("database down"));

    const response = await login(jsonLogin('{"email":"a@b.c","password":"pw"}'));

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("refuses cross-origin posts before reading credentials", async () => {
    const response = await login(
      formLogin(
        { email: "a@b.c", password: "pw" },
        { origin: "https://evil.example", host: "app.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect(provider.signIn).not.toHaveBeenCalled();
  });
});

describe("request body limit of the sign-in and sign-out routes", () => {
  const big = "x".repeat(9000);

  it("answers 413 to an oversized JSON or form body and does nothing else", async () => {
    for (const route of [login, requestCode, verifyCode]) {
      const json = await route(
        jsonPost("/api/auth/login", { email: "a@b.test", password: big, code: big }),
      );
      const form = await route(formLogin({ email: "a@b.test", password: big }));

      expect(json.status).toBe(413);
      expect(form.status).toBe(413);
      expect(await json.json()).toEqual({ error: "payload_too_large" });
    }
    expect(throttle.reserve).not.toHaveBeenCalled();
    expect(provider.signIn).not.toHaveBeenCalled();
  });

  it("counts the bytes while reading, whatever Content-Length says", async () => {
    const response = await login(
      formLogin({ email: "a@b.test", password: big }, { "content-length": "10" }),
    );

    expect(response.status).toBe(413);
  });

  it("answers 413 to an oversized logout form and keeps the session", async () => {
    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ returnTo: `/${big}` }),
      }),
    );

    expect(response.status).toBe(413);
    expect(provider.signOut).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookies and returns 204 for API clients", async () => {
    provider.signOut.mockResolvedValue(["krajozbior.session_token=; Max-Age=0"]);

    const response = await logout(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );

    expect(response.status).toBe(204);
    // Also the profile form draft of the shared device (L4).
    expect(response.headers.getSetCookie()).toEqual([
      "krajozbior.session_token=; Max-Age=0",
      "profile-draft=; Path=/my/settings; Max-Age=0; HttpOnly; SameSite=Lax",
      clearedAddress,
    ]);
  });

  it("redirects a form post to the public home page", async () => {
    provider.signOut.mockResolvedValue([]);

    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?wylogowano=1");
  });

  it("sends a form post that names a same-site returnTo to the login screen (E9-5, Q7)", async () => {
    provider.signOut.mockResolvedValue([]);

    const post = (body: string) =>
      logout(
        new Request("http://localhost/api/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      );

    expect((await post("returnTo=%2Fmy%2Fdelete-account")).headers.get("Location")).toBe(
      `/login?returnTo=${encodeURIComponent("/my/delete-account")}`,
    );
    // An address that leaves the site falls back to "/", never to the foreign host.
    expect((await post("returnTo=https%3A%2F%2Fevil.example")).headers.get("Location")).toBe(
      `/login?returnTo=${encodeURIComponent("/")}`,
    );
    expect((await post("returnTo=")).headers.get("Location")).toBe("/?wylogowano=1");
  });

  it("tells the home page that the terms were declined (F-K3, E11-Q4 A)", async () => {
    provider.signOut.mockResolvedValue([]);

    const post = (body: string) =>
      logout(
        new Request("http://localhost/api/auth/logout", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        }),
      );

    expect((await post("reason=terms-declined")).headers.get("Location")).toBe(
      "/?wylogowano=odmowa",
    );
    // Any other reason changes nothing.
    expect((await post("reason=whatever")).headers.get("Location")).toBe("/?wylogowano=1");
  });

  it("ignores an unreadable form body and goes to the home page", async () => {
    provider.signOut.mockResolvedValue([]);

    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=x" },
        body: "not a multipart body",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?wylogowano=1");
  });

  it("sends a form post back to the home page with an error signal when sign-out fails", async () => {
    provider.signOut.mockRejectedValue(new Error("still active"));

    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/?wylogowanie=blad");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("does not report success when the session could not be ended", async () => {
    provider.signOut.mockRejectedValue(new Error("still active"));

    const response = await logout(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("refuses cross-origin posts", async () => {
    const response = await logout(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { origin: "https://evil.example", host: "app.example" },
      }),
    );

    expect(response.status).toBe(403);
    expect(provider.signOut).not.toHaveBeenCalled();
  });
});
