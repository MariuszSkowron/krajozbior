import { NextResponse } from "next/server";

import { checkDatabaseConnection } from "@/lib/db/health";

// Health must check the live database, so it is never prerendered during build.
export const dynamic = "force-dynamic";

export async function GET() {
  const databaseOk = await checkDatabaseConnection();

  return NextResponse.json(
    { status: databaseOk ? "ok" : "unavailable" },
    { status: databaseOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
