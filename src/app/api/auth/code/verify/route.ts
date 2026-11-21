import { z } from "zod";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { getCodeVerifyThrottle, getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

import {
  accountThemeCookies,
  failure,
  isRefusedDemoAccount,
  NO_STORE,
  readInput,
  reserveAttempt,
  signedIn,
} from "../../auth-request";

export const dynamic = "force-dynamic";

const verifySchema = z.object({
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/),
});

// Step 2 of the e-mail sign-in: the code from the message signs the person in
// and, on first use, creates a `user` account (role forced by the database
// hooks, never taken from the request). An admin address is refused: admins
// sign in only with a password.
export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  let input: Record<string, unknown>;

  try {
    input = await readInput(request);
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }

  const returnTo = requestedReturnTo(input.returnTo);
  const parsed = verifySchema.safeParse({
    email: typeof input.email === "string" ? input.email.trim().toLowerCase() : input.email,
    code: typeof input.code === "string" ? input.code.trim() : input.code,
  });

  if (!parsed.success || isRefusedDemoAccount(parsed.data.email)) {
    return failure(request, returnTo, 401, "invalid_code");
  }

  try {
    // Counted apart from password sign-in (CODE_VERIFY_PREFIX), so guessing
    // codes for an admin's address does not lock the admin's password sign-in.
    const throttle = getCodeVerifyThrottle();
    const attempt = await reserveAttempt(
      request,
      throttle,
      parsed.data.email,
      returnTo,
      "code_too_many_attempts",
    );

    if ("response" in attempt) {
      return attempt.response;
    }

    const provider = getIdentityProvider();
    const result = await provider.signInWithCode(parsed.data, request.headers);

    if (result === null) {
      return failure(request, returnTo, 401, "invalid_code");
    }

    await throttle.clearAccount(attempt.subject);
    await provider.signOut(request.headers);

    return signedIn(request, result, returnTo, await accountThemeCookies(result.actor));
  } catch (error) {
    logFailure("Sign-in with code", error);
    return failure(request, returnTo, 503, "code_unavailable");
  }
}
