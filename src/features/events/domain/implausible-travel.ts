import { MAX_TRAVEL_SPEED_MPS } from "./limits";

/**
 * "Impossible travel" between two on-site visits (D-E6-6). Distances in metres, time in
 * seconds. The radii of both places are subtracted from the distance, a negative time counts
 * as 0, and there is no division: with 0 seconds any positive remaining distance is impossible,
 * and a remaining distance of 0 is always possible.
 */
export function isImpossibleTravel(input: {
  distanceM: number;
  radiusFromM: number;
  radiusToM: number;
  elapsedSeconds: number;
}): boolean {
  const remaining = Math.max(0, input.distanceM - input.radiusFromM - input.radiusToM);
  const elapsed = Math.max(0, input.elapsedSeconds);

  return remaining > 0 && remaining > MAX_TRAVEL_SPEED_MPS * elapsed;
}
