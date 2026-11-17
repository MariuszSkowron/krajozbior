import { updatePlace } from "@/features/catalog/application/curator-places";
import { handleCurator, isUuid, notFound } from "@/features/catalog/http/curator-http";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) {
  const { placeId } = await params;

  if (!isUuid(placeId)) {
    return notFound();
  }

  return handleCurator(request, {
    successStatus: 200,
    run: (actor, body, deps) => updatePlace(actor, placeId, body, deps),
  });
}
