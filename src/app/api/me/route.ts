import { authorizeRequest } from "@/features/identity/application/authorize";
import { getIdentityProvider } from "@/features/identity/infrastructure";

export const dynamic = "force-dynamic";

// Any signed-in role: the account of the session. A guest browser is sent to
// /login, an API client gets 401.
export async function GET(request: Request) {
  const result = await authorizeRequest(request, getIdentityProvider());

  if ("response" in result) {
    return result.response;
  }

  return Response.json(
    { id: result.actor.id, role: result.actor.role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
