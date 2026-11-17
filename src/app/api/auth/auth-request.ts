import { clientIp } from "@/features/identity/domain/client-ip";
import { isDemoEmail } from "@/features/identity/domain/demo-account-list";
import type { SignInResult } from "@/features/identity/domain/identity-provider";
import { roleHome } from "@/features/identity/domain/role-home";
import type { SignInThrottle, ThrottleSubject } from "@/features/identity/domain/sign-in-throttle";
import { getClientIpHeader } from "@/features/identity/infrastructure";
import { isDemoSignInAllowed } from "@/lib/config/env";

/**
 * True when the address is a demo account and this deployment must not sign it
 * in (production without the test flag). The routes then answer exactly as
 * for wrong credentials, so nothing tells a demo account apart.
 */
export function isRefusedDemoAccount(email: string): boolean {
  return isDemoEmail(email) && !isDemoSignInAllowed(process.env);
}

/** The client address from the configured header, with a warning when it is missing. */
export function requestClientIp(request: Request): string | null {
  const ipHeader = getClientIpHeader();
  const ip = clientIp(request.headers, ipHeader);

  // The request did not come through the proxy that sets the header; the
  // account limits still apply.
  if (ipHeader !== undefined && ip === null) {
    console.warn(JSON.stringify({ event: "auth.client_ip_missing", header: ipHeader }));
  }

  return ip;
}

// Shared by the sign-in routes: a native form post (works without JavaScript)
// gets a 303 back to a page, a JSON client gets a status and a JSON body.
export const NO_STORE = { "Cache-Control": "no-store" };

export function isFormPost(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";

  return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
}

export async function readInput(request: Request): Promise<Record<string, unknown>> {
  if (isFormPost(request)) {
    return Object.fromEntries(await request.formData());
  }

  const body: unknown = await request.json();

  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/** A refusal: the form goes back to /login with the code, a JSON client gets the status. */
export function failure(
  request: Request,
  returnTo: string | null,
  status: number,
  code: string,
  extraHeaders: Record<string, string> = {},
): Response {
  if (isFormPost(request)) {
    const query = new URLSearchParams({ error: code });

    if (returnTo !== null) {
      query.set("returnTo", returnTo);
    }

    return new Response(null, {
      status: 303,
      headers: { Location: `/login?${query}`, ...NO_STORE, ...extraHeaders },
    });
  }

  return Response.json({ error: code }, { status, headers: { ...NO_STORE, ...extraHeaders } });
}

/**
 * Counts one attempt for the address before anything is checked, for existing
 * and unknown accounts alike, so the limit reveals nothing about which accounts
 * exist. Returns the subject (to clear it after a success) or the refusal.
 */
export async function reserveAttempt(
  request: Request,
  throttle: SignInThrottle,
  email: string,
  returnTo: string | null,
  limitCode = "too_many_attempts",
): Promise<{ subject: ThrottleSubject } | { response: Response }> {
  const subject = { email, ip: requestClientIp(request) };
  const decision = await throttle.reserve(subject);

  if (!decision.allowed) {
    return {
      response: failure(request, returnTo, 429, limitCode, {
        "Retry-After": String(decision.retryAfterSeconds),
      }),
    };
  }

  return { subject };
}

/** The response of a successful sign-in: the session cookies and the destination. */
export function signedIn(request: Request, result: SignInResult, returnTo: string | null) {
  const headers = new Headers(NO_STORE);
  const destination = returnTo ?? roleHome(result.actor.role);

  for (const cookie of result.setCookies) {
    headers.append("Set-Cookie", cookie);
  }

  if (isFormPost(request)) {
    headers.set("Location", destination);

    return new Response(null, { status: 303, headers });
  }

  return Response.json(
    { role: result.actor.role, returnTo: destination },
    { status: 200, headers },
  );
}
