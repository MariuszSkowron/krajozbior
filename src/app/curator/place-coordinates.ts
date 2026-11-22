// Coordinates in the place editor: one format for the fields, the status line and the hints
// (comma as the separator, up to 6 decimals), and one rule for when typed text may move the pin.

import { parseNumberField } from "./failure-message";

export type PinPosition = Readonly<{ latitude: number; longitude: number }>;

const LATITUDE_LIMIT = 90;
const LONGITUDE_LIMIT = 180;

/** 54.0928 -> "54,0928": at most 6 decimals, no trailing zeros, comma. */
export function formatCoordinate(value: number): string {
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

function inRange(text: string, limit: number): number | null {
  const parsed = parseNumberField(text);

  return typeof parsed === "number" && Math.abs(parsed) <= limit ? parsed : null;
}

/** The pin position for two typed texts; `null` unless both are numbers in range. */
export function readPosition(latitudeText: string, longitudeText: string): PinPosition | null {
  const latitude = inRange(latitudeText, LATITUDE_LIMIT);
  const longitude = inRange(longitudeText, LONGITUDE_LIMIT);

  return latitude === null || longitude === null ? null : { latitude, longitude };
}

/**
 * A note for typed texts that cannot move the pin (one field empty, not a number, out of range);
 * `null` when the pin follows them or both fields are empty (the status line says "not set").
 */
export function typedPinNote(latitudeText: string, longitudeText: string): string | null {
  if (readPosition(latitudeText, longitudeText) !== null) {
    return null;
  }

  if (latitudeText.trim() === "" && longitudeText.trim() === "") {
    return null;
  }

  return "Położenie poza zakresem lub niepełne — pinezka bez zmian";
}

/** The radius for a typed text; `null` unless it is a positive whole number. */
export function readRadius(text: string): number | null {
  const parsed = parseNumberField(text);

  return typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function describePin(position: PinPosition | null): string {
  return position === null
    ? "Położenie nie jest jeszcze ustawione"
    : `Pinezka: ${formatCoordinate(position.latitude)}, ${formatCoordinate(position.longitude)}`;
}
