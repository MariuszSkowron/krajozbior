import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import { logFailure } from "@/lib/log-failure";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

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
    // Only a signal for the home page message; any other value changes nothing.
    headers.set("Location", "/?wylogowano=1");

    return new Response(null, { status: 303, headers });
  }

  return new Response(null, { status: 204, headers });
}
