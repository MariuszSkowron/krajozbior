import { isSameOrigin } from "@/features/identity/domain/origin";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// `returnTo` of a form post: a same-site path (safeReturnTo falls back to "/" for
// anything else) or null when the form names none.
async function formReturnTo(request: Request): Promise<string | null> {
  try {
    return requestedReturnTo((await request.formData()).get("returnTo") ?? undefined);
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const isForm = (request.headers.get("content-type") ?? "").includes("form");
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

  if (isForm) {
    // The deletion screen asks for a fresh sign-in (E9-5, Q7): its logout form
    // names a same-site path to come back to after signing in again. Without it,
    // only a signal for the home page message; any other value changes nothing.
    const returnTo = await formReturnTo(request);

    headers.set(
      "Location",
      returnTo === null ? "/?wylogowano=1" : `/login?returnTo=${encodeURIComponent(returnTo)}`,
    );

    return new Response(null, { status: 303, headers });
  }

  return new Response(null, { status: 204, headers });
}
