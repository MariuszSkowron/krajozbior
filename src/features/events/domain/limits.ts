// Frozen rules of an event with a legendary card (spec E6, E6-Q6, E6-Q7, D-E6-6).
// The database repeats them in triggers (E6-1a) and in record_on_site_visit() (E6-3).

/** Events are given and shown in Polish time (E6-Q6). */
export const EVENT_TIME_ZONE = "Europe/Warsaw";

export const EVENT_MIN_DURATION_MS = 60 * 60 * 1000;
export const EVENT_MAX_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** A new event may be announced at most one year ahead (E6-Q7). */
export const EVENT_MAX_YEARS_AHEAD = 1;

/** Night hours in Polish time: from 22:00 to 06:00 the next morning (E6-Q16). */
export const EVENT_NIGHT_START_HOUR = 22;
export const EVENT_NIGHT_END_HOUR = 6;

/** D-E6-6: 250 km/h expressed in metres per second. The database holds the same constant. */
export const MAX_TRAVEL_SPEED_MPS = 69.44;
