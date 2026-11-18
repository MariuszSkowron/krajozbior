import { createCollection } from "@/features/catalog/application/curator-collections";
import { handleCurator } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

// A curator creates a draft collection (always a draft, whatever the body says).
export async function POST(request: Request) {
  return handleCurator(request, {
    successStatus: 201,
    run: (actor, body, deps) => createCollection(actor, body, deps),
  });
}
