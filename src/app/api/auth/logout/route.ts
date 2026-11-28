import { loginEmailClearCookieHeader } from "@/app/login/login-email-cookie";
import { isSameOrigin } from "@/features/identity/domain/origin";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { clearedProfileDraftCookie } from "@/features/profile/domain/profile-draft";
import { readBoundedForm } from "@/features/visits/http/request-body";
import { logFailure } from "@/lib/log-failure";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// What a form post asks for: `returnTo` is a same-site path (safeReturnTo falls back to "/"
// for anything else) or null when the form names none. The declined terms have their own route
// (/api/me/terms-decline); an old `reason` field is ignored, so no message claims a deletion.
function formReturnTo(form: FormData | null): string | null {
  return form === null ? null : requestedReturnTo(form.get("returnTo") ?? undefined);
}

// The form holds a return path and a signal: far less than this.
const FORM_MAX_BYTES = 4 * 1024;

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const isForm = (request.headers.get("content-type") ?? "").includes("form");
  let form: FormData | null = null;

  // Read before anything else happens, and never more than the limit.
  if (isForm) {
    const read = await readBoundedForm(request, FORM_MAX_BYTES);

    if ("tooLarge" in read) {
      return Response.json({ error: "payload_too_large" }, { status: 413, headers: NO_STORE });
    }

    form = read.form;
  }

  let cookies: string[];

  try {
    cookies = await getIdentityProvider().signOut(request.headers);
  } catch (error) {
    logFailure("Sign-out", error);

    // The session could not be ended; do not claim a successful logout. A form
    // gets the home page with an error message, not raw JSON.
    if (isForm) {
      return new Response(null, {
        status: 303,
        headers: { ...NO_STORE, Location: "/?wylogowanie=blad" },
      });
    }

    return Response.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }

  const headers = new Headers(NO_STORE);

  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  // The typed profile form values must not stay on a shared device (L4).
  headers.append("Set-Cookie", clearedProfileDraftCookie());
  // So is the address kept for the code sign-in (login-email-cookie.ts).
  headers.append("Set-Cookie", loginEmailClearCookieHeader());

  if (isForm) {
    // The deletion screen asks for a fresh sign-in (E9-5, Q7): its logout form
    // names a same-site path to come back to after signing in again. Without it,
    // only a signal for the home page message.
    const returnTo = formReturnTo(form);

    headers.set(
      "Location",
      returnTo === null ? "/?wylogowano=1" : `/login?returnTo=${encodeURIComponent(returnTo)}`,
    );

    return new Response(null, { status: 303, headers });
  }

  return new Response(null, { status: 204, headers });
}
