import { reorderPlaces } from "@/features/catalog/application/curator-places";
import { handleCurator, isUuid, notFound } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

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
    run: (actor, body, deps) => reorderPlaces(actor, collectionId, body, deps),
  });
}
