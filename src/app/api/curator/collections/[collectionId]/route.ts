import {
  deleteDraftCollection,
  updateCollection,
} from "@/features/catalog/application/curator-collections";
import { handleCurator, isUuid, notFound } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ collectionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { collectionId } = await params;

  if (!isUuid(collectionId)) {
    return notFound();
  }

  return handleCurator(request, {
    successStatus: 200,
    run: (actor, body, deps) => updateCollection(actor, collectionId, body, deps),
  });
}

// Only a draft that was never published; anything else is 409.
export async function DELETE(request: Request, { params }: Context) {
  const { collectionId } = await params;

  if (!isUuid(collectionId)) {
    return notFound();
  }

  return handleCurator(request, {
    successStatus: 204,
    run: (actor, _body, deps) => deleteDraftCollection(actor, collectionId, deps),
  });
}
