import type { NearbyCandidate } from "@/features/catalog/domain/nearby";

// The public list of collections with their places, read only after a click on "Pokaż najbliższe".
// A plain GET without any parameter: the position of the device is never part of the request.
export async function fetchNearbyCandidates(): Promise<readonly NearbyCandidate[]> {
  const response = await fetch("/api/nearby");

  if (!response.ok) {
    throw new Error("nearby list unavailable");
  }

  const body = (await response.json()) as { candidates?: readonly NearbyCandidate[] };

  if (!Array.isArray(body.candidates)) {
    throw new Error("nearby list malformed");
  }

  return body.candidates;
}
