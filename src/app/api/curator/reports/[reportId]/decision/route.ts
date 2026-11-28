import { handleDecision } from "@/features/reports/http/decision-http";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const { reportId } = await params;

  return handleDecision(request, reportId);
}
