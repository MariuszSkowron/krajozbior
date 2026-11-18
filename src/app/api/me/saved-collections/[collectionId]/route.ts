import { saveCollection, unsaveCollection } from "@/features/album/application/saved-collections";
import { handleAlbumWrite } from "@/features/album/http/album-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ collectionId: string }> };

// The use cases turn a malformed id into `not_found` (after the session and
// the limit), so a guest gets 401 whatever the id is.
export async function PUT(request: Request, { params }: Context) {
  const { collectionId } = await params;

  return handleAlbumWrite(request, (actor, deps) => saveCollection(actor, collectionId, deps));
}

export async function DELETE(request: Request, { params }: Context) {
  const { collectionId } = await params;

  return handleAlbumWrite(request, (actor, deps) => unsaveCollection(actor, collectionId, deps));
}
