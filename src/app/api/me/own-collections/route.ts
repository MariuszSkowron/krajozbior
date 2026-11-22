import {
  createOwnCollection,
  listOwnCollections,
} from "@/features/own-collections/application/own-collections";
import { handleOwnCollections } from "@/features/own-collections/http/own-collections-http";

export const dynamic = "force-dynamic";

// The own collections of the signed-in explorer (E8-1a). The owner is always the session: no body
// names one. A guest gets 401.
export async function GET(request: Request) {
  return handleOwnCollections(request, {
    write: false,
    withBody: false,
    run: (actor, _body, deps) => listOwnCollections(actor, deps),
  });
}

export async function POST(request: Request) {
  return handleOwnCollections(request, {
    write: true,
    withBody: true,
    run: (actor, body, deps) => createOwnCollection(actor, body, deps),
  });
}
