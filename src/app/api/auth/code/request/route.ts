import { z } from "zod";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { entryPath, loginEntry } from "@/features/identity/domain/login-entry";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import {
  cleanupExpiredSessions,
  getIdentityProvider,
  getOtpSendLimiter,
} from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import { loginEmailSetCookieHeader } from "@/app/login/login-email-cookie";

import {
  failure,
  invalidInputResponse,
  isFormPost,
  isRefusedDemoAccount,
  NO_STORE,
  readInput,
  requestClientIp,
} from "../../auth-request";

export const dynamic = "force-dynamic";

const requestSchema = z.object({ email: z.email().max(254) });

// Step 1 of the e-mail sign-in: sends a six-digit code. The answer is the same
// for a new address, an existing account and an admin address (which never
// gets a code), so it reveals nothing about accounts.
//
// Requests have limits of their own (otp-send-limits.ts): per address (aliases
// such as `+tag` count as one address), per address from one IP, per IP and a
// global daily limit of the application. They are counted apart from password
// sign-in, so asking for codes to an admin's address never uses up the admin's
// password attempts.
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  let input: Record<string, unknown>;

  try {
    input = await readInput(request);
  } catch (error) {
    return invalidInputResponse(error);
  }

  const returnTo = requestedReturnTo(input.returnTo);
  // Which entrance the forms came from ("Zaloguj się" or "Załóż konto"): only the page the
  // person returns to and the wording differ; the mechanism is the same.
  const entry = loginEntry(input.entry);
  const parsed = requestSchema.safeParse({
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : input.email,
  });

  if (!parsed.success) {
    return failure(request, returnTo, 400, "invalid_email", {}, entry);
  }

  // A demo address on a production deployment: answered like any other
  // address, but nothing is counted or sent.
  if (!isRefusedDemoAccount(parsed.data.email)) {
    try {
      const decision = await getOtpSendLimiter().reserve({
        email: parsed.data.email,
        ip: requestClientIp(request),
      });

      if (!decision.allowed) {
        const retryAfter = { "Retry-After": String(decision.retryAfterSeconds) };

        return decision.reason === "global"
          ? failure(request, returnTo, 503, "code_unavailable", retryAfter, entry)
          : failure(request, returnTo, 429, "code_too_many_attempts", retryAfter, entry);
      }

      // Best effort and bounded; its failure never blocks the code.
      await cleanupExpiredSessions();
      await getIdentityProvider().requestSignInCode(parsed.data.email, request.headers);
    } catch (error) {
      logFailure("Sign-in code request", error);
      return failure(request, returnTo, 503, "code_unavailable", {}, entry);
    }
  }

  if (isFormPost(request)) {
    const query = new URLSearchParams({ kod: "wyslany" });

    if (returnTo !== null) {
      query.set("returnTo", returnTo);
    }

    // The address goes to step 2 in a cookie, never in the URL (login-email-cookie.ts). Set for
    // every well-formed address alike, so the answer still reveals nothing about accounts.
    const headers = new Headers({ Location: `${entryPath(entry)}?${query}`, ...NO_STORE });

    headers.append("Set-Cookie", loginEmailSetCookieHeader(parsed.data.email));

    return new Response(null, { status: 303, headers });
  }

  return Response.json({ status: "sent" }, { status: 202, headers: NO_STORE });
}
