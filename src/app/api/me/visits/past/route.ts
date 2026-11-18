import { handlePastVisitsRequest } from "@/features/visits/http/past-visit-http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handlePastVisitsRequest(request);
}
