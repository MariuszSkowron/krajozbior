import {
  addPlaceToOwnCollection,
  removeEntryFromOwnCollection,
} from "@/features/own-collections/application/own-collections";
import { handleOwnCollections } from "@/features/own-collections/http/own-collections-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// Adds a place of the public catalog (`{ placeId }`); a place that is not public, and the
// collection of somebody else, answer 404 the same way. Idempotent.
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;

  return handleOwnCollections(request, {
    write: true,
    withBody: true,
    run: (actor, body, deps) => addPlaceToOwnCollection(actor, id, body, deps),
  });
}

// Removes one entry (`{ itemId }`), also the one of a place the curator deleted.
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;

  return handleOwnCollections(request, {
    write: true,
    withBody: true,
    run: (actor, body, deps) => removeEntryFromOwnCollection(actor, id, body, deps),
  });
}
