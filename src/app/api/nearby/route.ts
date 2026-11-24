import { NextResponse } from "next/server";

import { logReadFailure } from "@/app/request-actor";
import { listNearbyCandidates } from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

// The public list behind "Pokaż najbliższe" on the home page: the same for everyone (the guest
// context, the same conditions of visibility as the album), places rounded to about 100 m. It is
// fetched only after a click, so the home page itself carries no coordinates. The request holds
// no position of the device: the distance is counted in the browser (D-14, E12-3).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const candidates = await listNearbyCandidates(getCatalogDeps());

    return NextResponse.json(
      { candidates },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (error) {
    logReadFailure("Nearby API read", error);

    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
