import { z } from "zod";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { getIdentityProvider, getSignInThrottle } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import {
  accountThemeCookies,
  failure,
  invalidInputResponse,
  isRefusedDemoAccount,
  NO_STORE,
  readInput,
  reserveAttempt,
  signedIn,
} from "../auth-request";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(256),
});

// Password sign-in (demo and admin accounts).
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
  const parsed = loginSchema.safeParse(input);

  // Same answer for malformed input and wrong credentials: nothing reveals
  // whether an account exists or which field was wrong. A demo account on a
  // production deployment gets the same answer: its password is shared.
  if (!parsed.success || isRefusedDemoAccount(parsed.data.email)) {
    return failure(request, returnTo, 401, "invalid_credentials");
  }

  try {
    const throttle = getSignInThrottle();
    const attempt = await reserveAttempt(request, throttle, parsed.data.email, returnTo);

    if ("response" in attempt) {
      return attempt.response;
    }

    const provider = getIdentityProvider();
    const result = await provider.signIn(parsed.data, request.headers);

    if (result === null) {
      return failure(request, returnTo, 401, "invalid_credentials");
    }

    await throttle.clearAccount(attempt.subject);

    // A session the browser already had must not outlive this sign-in. Revoked
    // only after success, so a failed attempt keeps the current user signed in.
    await provider.signOut(request.headers);

    return signedIn(request, result, returnTo, await accountThemeCookies(result.actor));
  } catch (error) {
    logFailure("Sign-in", error);
    // Provider or database failure: no session cookie is sent. A session created
    // before a failed revocation is never delivered and expires on its own, so
    // retry is safe.
    return failure(request, returnTo, 503, "unavailable");
  }
}
