import { addPlace } from "@/features/catalog/application/curator-places";
import { handleCurator, isUuid, notFound } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

// Creates a place of the collection's organization (or links an existing one
// by `placeId`) and puts it at the end of the list.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await params;

  if (!isUuid(collectionId)) {
    return notFound();
  }

  return handleCurator(request, {
    successStatus: 201,
    run: (actor, body, deps) => addPlace(actor, collectionId, body, deps),
  });
}
