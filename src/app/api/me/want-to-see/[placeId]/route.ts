import {
  addToWantToSee,
  removeFromWantToSee,
} from "@/features/want-to-see/application/want-to-see";
import { handleWantToSeeWrite } from "@/features/want-to-see/http/want-to-see-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ placeId: string }> };

// The use cases turn a malformed id into `not_found` (after the session and
// the limit), so a guest gets 401 whatever the id is.
export async function PUT(request: Request, { params }: Context) {
  const { placeId } = await params;

  return handleWantToSeeWrite(request, (actor, deps) => addToWantToSee(actor, placeId, deps));
}

export async function DELETE(request: Request, { params }: Context) {
  const { placeId } = await params;

  return handleWantToSeeWrite(request, (actor, deps) => removeFromWantToSee(actor, placeId, deps));
}
