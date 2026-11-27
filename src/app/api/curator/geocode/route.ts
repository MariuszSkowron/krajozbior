import { searchAddress } from "@/features/catalog/application/curator-geocode";
import { handleCurator } from "@/features/catalog/http/curator-http";
import { getGeocoder } from "@/features/catalog/infrastructure/nominatim-geocoder";

export const dynamic = "force-dynamic";

// `{ query }` gives the places the public geocoding service finds for an address (K-2). Only
// a curator may ask, with a limit per user; a failure of the service is 503.
export async function POST(request: Request) {
  return handleCurator(request, {
    successStatus: 200,
    run: (actor, body, deps) => searchAddress(actor, body, deps, getGeocoder()),
  });
}
