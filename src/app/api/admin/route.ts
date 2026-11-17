import { authorizeRequest } from "@/features/identity/application/authorize";
import { getIdentityProvider } from "@/features/identity/infrastructure";

export const dynamic = "force-dynamic";

// Admin only: a signed-in `user` gets 403 whatever the UI shows, a guest 401.
// The pattern for every route of a role with extra rights.
export async function GET(request: Request) {
  const result = await authorizeRequest(request, getIdentityProvider(), "admin");

  if ("response" in result) {
    return result.response;
  }

  return Response.json(
    { id: result.actor.id, role: result.actor.role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
