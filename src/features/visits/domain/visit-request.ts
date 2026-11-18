import { isUuid } from "@/features/catalog/domain/uuid";

// The body of POST /api/places/[placeId]/visits: the reading of the device and
// the id of this attempt. Only the shape is checked here (finite numbers in
// range, a UUID); whether the person is near enough is decided by the database
// alone (spec D-T3). Nothing of this is stored or logged.
export type VisitRequest = Readonly<{
  latitude: number;
  longitude: number;
  accuracyM: number;
  clientVisitId: string;
}>;

const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function parseVisitRequest(body: unknown): VisitRequest | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const { latitude, longitude, accuracy, clientVisitId } = body as Record<string, unknown>;

  if (
    !isNumberIn(latitude, -90, 90) ||
    !isNumberIn(longitude, -180, 180) ||
    !isNumberIn(accuracy, 0, Number.MAX_VALUE) ||
    !isUuid(clientVisitId)
  ) {
    return null;
  }

  return { latitude, longitude, accuracyM: accuracy, clientVisitId };
}
