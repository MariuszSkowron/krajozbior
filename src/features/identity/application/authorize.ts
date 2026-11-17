import {
  AuthenticationRequiredError,
  ForbiddenError,
  requireActor,
  requireRole,
  type Actor,
  type Role,
} from "../domain/actor";
import type { IdentityProvider } from "../domain/identity-provider";

const NO_STORE = { "Cache-Control": "no-store" };

function wantsHtml(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";

  return accept.includes("text/html") && !accept.includes("application/json");
}

function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const returnTo = encodeURIComponent(`${url.pathname}${url.search}`);

  return new Response(null, {
    status: 303,
    headers: { Location: `/login?returnTo=${returnTo}`, ...NO_STORE },
  });
}

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: NO_STORE });
}

// Resolves the actor for a protected route handler, or the response to return.
// Without a session: browser navigation is sent to the login page, API clients
// get 401. A signed-in actor with the wrong role gets 403 whatever the UI shows.
export async function authorizeRequest(
  request: Request,
  provider: IdentityProvider,
  ...allowed: Role[]
): Promise<{ actor: Actor } | { response: Response }> {
  try {
    const actor = await provider.getActor(request.headers);

    return { actor: allowed.length > 0 ? requireRole(actor, ...allowed) : requireActor(actor) };
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return {
        response: wantsHtml(request) ? loginRedirect(request) : json(401, "unauthenticated"),
      };
    }

    if (error instanceof ForbiddenError) {
      return { response: json(403, "forbidden") };
    }

    throw error;
  }
}
