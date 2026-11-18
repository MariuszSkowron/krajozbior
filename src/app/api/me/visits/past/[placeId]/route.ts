import { handleDeletePastVisit } from "@/features/visits/http/past-visit-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ placeId: string }> };

// The use case turns a malformed id into `not_found` (after the session and the
// limit), so a guest gets 401 whatever the id is.
export async function DELETE(request: Request, { params }: Context) {
  const { placeId } = await params;

  return handleDeletePastVisit(request, placeId);
}
