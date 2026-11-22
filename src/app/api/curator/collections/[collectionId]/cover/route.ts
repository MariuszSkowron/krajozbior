import { setCollectionCover } from "@/features/catalog/application/curator-cover";
import { handleCurator, isUuid, notFound } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

// `{ placePhotoId }` sets the cover, `{}` clears it (E4-3). A photo that is not a ready, visible
// photo of a place in the collection gives 422.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;

  if (!isUuid(collectionId)) {
    return notFound();
  }

  return handleCurator(request, {
    successStatus: 200,
    run: (actor, body, deps) => setCollectionCover(actor, collectionId, body, deps),
  });
}
