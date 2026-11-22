import {
  deleteOwnCollection,
  updateOwnCollection,
} from "@/features/own-collections/application/own-collections";
import { handleOwnCollections } from "@/features/own-collections/http/own-collections-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

// Another person's id answers 404, the same as a missing one. A malformed id is turned into 404 by
// the use case (after the session and the limit), so a guest gets 401 whatever the id is.
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;

  return handleOwnCollections(request, {
    write: true,
    withBody: true,
    run: (actor, body, deps) => updateOwnCollection(actor, id, body, deps),
  });
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;

  return handleOwnCollections(request, {
    write: true,
    withBody: false,
    run: (actor, _body, deps) => deleteOwnCollection(actor, id, deps),
  });
}
