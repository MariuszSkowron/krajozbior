import { handleVisitRequest } from "@/features/visits/http/visit-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ placeId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { placeId } = await params;

  return handleVisitRequest(request, placeId);
}
