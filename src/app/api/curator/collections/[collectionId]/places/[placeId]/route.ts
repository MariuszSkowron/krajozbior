import { removePlaceFromCollection } from "@/features/catalog/application/curator-places";
import { handleCurator, isUuid, notFound } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

// Removes the place from this collection only; the place itself stays.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ collectionId: string; placeId: string }> },
) {
  const { collectionId, placeId } = await params;

  if (!isUuid(collectionId) || !isUuid(placeId)) {
    return notFound();
  }

  return handleCurator(request, {
    successStatus: 204,
    run: (actor, _body, deps) => removePlaceFromCollection(actor, collectionId, placeId, deps),
  });
}
