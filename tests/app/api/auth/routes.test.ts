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

const ipHeader = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("@/features/identity/infrastructure", () => ({
  getIdentityProvider: (): IdentityProvider => provider,
  getSignInThrottle: () => throttle,
  getCodeVerifyThrottle: () => codeThrottle,
  getOtpSendLimiter: () => otpLimiter,
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
    expect(response.headers.getSetCookie()).toEqual(["krajozbior.session_token=a; HttpOnly"]);
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

  it("revokes the session the browser already had after a successful login", async () => {
    provider.signIn.mockResolvedValue({ actor, setCookies: ["krajozbior.session_token=new"] });
    provider.signOut.mockResolvedValue(["krajozbior.session_token=; Max-Age=0"]);

    const request = jsonLogin('{"email":"a@b.c","password":"pw"}');
    const response = await login(request);

    expect(provider.signOut).toHaveBeenCalledWith(request.headers);
    // Only the new session cookie goes back; the clearing cookie would drop it.
    expect(response.headers.getSetCookie()).toEqual(["krajozbior.session_token=new"]);
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
