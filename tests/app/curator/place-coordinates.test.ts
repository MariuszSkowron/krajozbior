import { describe, expect, it } from "vitest";

import {
  describePin,
  formatCoordinate,
  readPosition,
  readRadius,
  typedPinNote,
} from "@/app/curator/place-coordinates";
import { placeNotice } from "@/app/curator/place-notice";

describe("formatCoordinate", () => {
  it("uses a comma, at most 6 decimals and no trailing zeros", () => {
    expect(formatCoordinate(54.0928)).toBe("54,0928");
    expect(formatCoordinate(18.79190000001)).toBe("18,7919");
    expect(formatCoordinate(-0.5)).toBe("-0,5");
    expect(formatCoordinate(54)).toBe("54");
    expect(formatCoordinate(100)).toBe("100");
    expect(formatCoordinate(54.1234567)).toBe("54,123457");
  });
});

describe("readPosition", () => {
  it("reads a comma and a dot alike", () => {
    expect(readPosition("54,0928", "18.7919")).toEqual({ latitude: 54.0928, longitude: 18.7919 });
  });

  it("does not move the pin for a value out of range or not a number", () => {
    expect(readPosition("95", "18")).toBeNull();
    expect(readPosition("54", "181")).toBeNull();
    expect(readPosition("-90,5", "18")).toBeNull();
    expect(readPosition("abc", "18")).toBeNull();
    expect(readPosition("", "")).toBeNull();
  });

  it("accepts the limits", () => {
    expect(readPosition("90", "-180")).toEqual({ latitude: 90, longitude: -180 });
  });
});

describe("readRadius", () => {
  it("accepts a positive whole number only", () => {
    expect(readRadius("200")).toBe(200);
    expect(readRadius("20,5")).toBeNull();
    expect(readRadius("0")).toBeNull();
    expect(readRadius("x")).toBeNull();
  });
});

describe("typedPinNote", () => {
  it("is silent when the pin follows the texts or both are empty", () => {
    expect(typedPinNote("54,1", "18,7")).toBeNull();
    expect(typedPinNote("", "")).toBeNull();
    expect(typedPinNote("  ", "")).toBeNull();
  });

  it("explains an empty field, a non-number and an out-of-range value", () => {
    expect(typedPinNote("54,1", "")).toMatch(/pinezka bez zmian/);
    expect(typedPinNote("", "18,7")).toMatch(/pinezka bez zmian/);
    expect(typedPinNote("abc", "18,7")).toMatch(/pinezka bez zmian/);
    expect(typedPinNote("95", "18,7")).toMatch(/pinezka bez zmian/);
    expect(typedPinNote("54,1", "181")).toMatch(/pinezka bez zmian/);
  });
});

describe("describePin", () => {
  it("tells the position or that it is not set", () => {
    expect(describePin({ latitude: 54.0928, longitude: 18.7919 })).toBe(
      "Pinezka: 54,0928, 18,7919",
    );
    expect(describePin(null)).toBe("Położenie nie jest jeszcze ustawione");
  });
});

describe("placeNotice", () => {
  const ids = ["a", "b"];

  it("chooses the message by the parameter", () => {
    expect(placeNotice({ saved: "a" }, ids)).toEqual({
      placeId: "a",
      message: "Zapisano zmiany miejsca",
    });
    expect(placeNotice({ added: "b" }, ids)).toEqual({ placeId: "b", message: "Dodano miejsce" });
  });

  it("ignores an id that is not on the list and a list of values", () => {
    expect(placeNotice({ saved: "zzz" }, ids)).toBeNull();
    expect(placeNotice({ saved: ["a", "b"] }, ids)).toBeNull();
    expect(placeNotice({}, ids)).toBeNull();
  });
});
