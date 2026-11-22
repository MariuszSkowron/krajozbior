import { describe, expect, it } from "vitest";
import { isImpossibleTravel } from "@/features/events/domain/implausible-travel";
import { MAX_TRAVEL_SPEED_MPS } from "@/features/events/domain/limits";

const travel = (distanceM: number, elapsedSeconds: number, radiusFromM = 0, radiusToM = 0) =>
  isImpossibleTravel({ distanceM, radiusFromM, radiusToM, elapsedSeconds });

describe("isImpossibleTravel", () => {
  it("is 250 km/h", () => {
    expect(MAX_TRAVEL_SPEED_MPS).toBe(69.44);
  });

  it("is possible exactly at the threshold and impossible just above it", () => {
    // 100 s at 69.44 m/s = 6944 m
    expect(travel(6944, 100)).toBe(false);
    expect(travel(6944.01, 100)).toBe(true);
    expect(travel(6943.99, 100)).toBe(false);
  });

  it("subtracts both radii from the distance", () => {
    expect(travel(7144, 100, 100, 100)).toBe(false);
    expect(travel(7144.01, 100, 100, 100)).toBe(true);
  });

  it("is impossible at zero time with any remaining distance, possible when the radii overlap", () => {
    expect(travel(1, 0)).toBe(true);
    expect(travel(500, 0, 250, 250)).toBe(false);
    expect(travel(0, 0)).toBe(false);
    expect(travel(100, 0, 300, 300)).toBe(false);
  });

  it("treats a negative time as zero", () => {
    expect(travel(10, -5)).toBe(true);
    expect(travel(0, -5)).toBe(false);
  });
});
