import { handleSubmitReport } from "@/features/reports/http/submit-http";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ placeId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { placeId } = await params;

  return handleSubmitReport(request, placeId);
}
