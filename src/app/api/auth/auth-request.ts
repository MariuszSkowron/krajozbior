import { clientIp } from "@/features/identity/domain/client-ip";
import { isDemoEmail } from "@/features/identity/domain/demo-account-list";
import type { SignInResult } from "@/features/identity/domain/identity-provider";
import { signInDestination } from "@/features/identity/domain/role-home";
import type { SignInThrottle, ThrottleSubject } from "@/features/identity/domain/sign-in-throttle";
import { getClientIpHeader } from "@/features/identity/infrastructure";
import { getMyTheme } from "@/features/settings/application/settings";
import type { SettingsDeps } from "@/features/settings/application/settings-types";
import { getSettingsDeps } from "@/features/settings/infrastructure/settings-deps";
import {
  approvedOrganizations,
  listMyOrganizations,
} from "@/features/organizations/application/list-my-organizations";
import { listMyOrganizationsDeps } from "@/features/organizations/infrastructure/postgres-organization-reader";
import { readBoundedForm, readJsonBody } from "@/features/visits/http/request-body";
import { isDemoSignInAllowed } from "@/lib/config/env";
import { logFailure } from "@/lib/log-failure";

import { themeSetCookieHeader } from "../../shell/theme";

/**
 * The `Set-Cookie` of the theme saved on the account of the person who just signed in (E9-4,
 * Q11 variant A): the choice comes back on every device. An account that never chose gets no
 * cookie (the one of the browser stays). A failure never blocks the sign-in: the person keeps
 * the theme of the browser and the failure goes to the log.
 */
export async function accountThemeCookies(
  actor: SignInResult["actor"],
  deps: SettingsDeps = getSettingsDeps(),
): Promise<string[]> {
  try {
    const outcome = await getMyTheme(actor, deps);

    return outcome.status === "ok" && outcome.value !== null
      ? [themeSetCookieHeader(outcome.value)]
      : [];
  } catch (error) {
    logFailure("Theme read after sign-in", error);

    return [];
  }
}

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

// The sign-in bodies hold an address, a password or a code and a return path: far less.
const INPUT_MAX_BYTES = 8 * 1024;

/** Thrown by `readInput` for a body over the limit; the routes answer 413. */
export class PayloadTooLargeError extends Error {}

export async function readInput(request: Request): Promise<Record<string, unknown>> {
  if (isFormPost(request)) {
    const read = await readBoundedForm(request, INPUT_MAX_BYTES);

    if ("tooLarge" in read) {
      throw new PayloadTooLargeError();
    }

    if (read.form === null) {
      throw new Error("The body is not a form");
    }

    return Object.fromEntries(read.form);
  }

  const read = await readJsonBody(request, INPUT_MAX_BYTES);

  if ("tooLarge" in read) {
    throw new PayloadTooLargeError();
  }

  // A body that is not JSON stays a bad request, as before.
  if (read.body === undefined) {
    throw new Error("The body is not JSON");
  }

  const body = read.body;

  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

/** The refusal of a failed `readInput`: 413 for a body over the limit, 400 otherwise. */
export function invalidInputResponse(error: unknown): Response {
  return error instanceof PayloadTooLargeError
    ? Response.json({ error: "payload_too_large" }, { status: 413, headers: NO_STORE })
    : Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
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

/**
 * Whether the account that just signed in is a curator (an `approved` organization). Read in
 * the user context with the actor of the sign-in result: the session cookie does not exist
 * yet, and nothing from the request names the account. It only chooses the landing page
 * (the panel checks the membership itself), so a failure never blocks the sign-in: the
 * account lands on its profile and the failure goes to the log.
 */
async function isCuratorAfterSignIn(actor: SignInResult["actor"]): Promise<boolean> {
  try {
    const result = await listMyOrganizations(actor, listMyOrganizationsDeps);

    return result.status === "ok" && approvedOrganizations(result.organizations).length > 0;
  } catch (error) {
    logFailure("Sign-in destination", error);

    return false;
  }
}

/** The response of a successful sign-in: the session cookies and the destination. */
export async function signedIn(
  request: Request,
  result: SignInResult,
  returnTo: string | null,
  extraCookies: readonly string[] = [],
) {
  const headers = new Headers(NO_STORE);
  // An explicit returnTo wins, so the membership is read only when it is needed.
  const destination = signInDestination({
    returnTo,
    isCurator: returnTo === null && (await isCuratorAfterSignIn(result.actor)),
  });

  for (const cookie of [...result.setCookies, ...extraCookies]) {
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
