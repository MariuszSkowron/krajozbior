// Place rules that need no database (E1).

export const PLACE_NAME_MAX_LENGTH = 120;
export const PLACE_DESCRIPTION_MAX_LENGTH = 4000;
export const PLACE_ADDRESS_MAX_LENGTH = 200;
export const PLACE_ACCESS_MAX_LENGTH = 1000;
export const VISIT_RADIUS_MIN_M = 50;
export const VISIT_RADIUS_MAX_M = 2000;
export const VISIT_RADIUS_DEFAULT_M = 200;

export type PlaceField =
  "name" | "description" | "address" | "accessInfo" | "latitude" | "longitude" | "visitRadiusM";

export type PlaceInput = Readonly<{
  name: string;
  description: string;
  address: string;
  accessInfo: string;
  latitude: number;
  longitude: number;
  visitRadiusM: number;
}>;

export type PlaceValidation =
  | Readonly<{ ok: true; value: PlaceInput }>
  | Readonly<{ ok: false; errors: readonly PlaceField[] }>;

function text(value: unknown, max: number, required: boolean): string | null {
  if (value === undefined && !required) {
    return "";
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n?/g, "\n").trim();

  return normalized.length <= max && (!required || normalized.length >= 1) ? normalized : null;
}

function coordinate(value: unknown, limit: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit
    ? value
    : null;
}

// Validates the whole place form. The radius is an integer from 50 m to 2 km
// and defaults to 200 m; coordinates are typed in by hand (no map yet).
export function validatePlaceInput(input: Record<string, unknown>): PlaceValidation {
  const errors: PlaceField[] = [];
  const name = text(input.name, PLACE_NAME_MAX_LENGTH, true);
  const description = text(input.description, PLACE_DESCRIPTION_MAX_LENGTH, false);
  const address = text(input.address, PLACE_ADDRESS_MAX_LENGTH, false);
  const accessInfo = text(input.accessInfo, PLACE_ACCESS_MAX_LENGTH, false);
  const latitude = coordinate(input.latitude, 90);
  const longitude = coordinate(input.longitude, 180);
  const radius = input.visitRadiusM === undefined ? VISIT_RADIUS_DEFAULT_M : input.visitRadiusM;

  if (name === null) errors.push("name");
  if (description === null) errors.push("description");
  if (address === null) errors.push("address");
  if (accessInfo === null) errors.push("accessInfo");
  if (latitude === null) errors.push("latitude");
  if (longitude === null) errors.push("longitude");

  const radiusOk =
    typeof radius === "number" &&
    Number.isInteger(radius) &&
    radius >= VISIT_RADIUS_MIN_M &&
    radius <= VISIT_RADIUS_MAX_M;

  if (!radiusOk) errors.push("visitRadiusM");

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: name as string,
      description: description as string,
      address: address as string,
      accessInfo: accessInfo as string,
      latitude: latitude as number,
      longitude: longitude as number,
      visitRadiusM: radius as number,
    },
  };
}
