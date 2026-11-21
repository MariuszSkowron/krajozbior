// Stałe budżetu i limity obróbki zdjęć mieszkają w jednym miejscu (`worker/budget.mjs`),
// bo plik procesu potomnego nie może importować TypeScriptu. Domena tylko je udostępnia.
export {
  MAIN_LONG_SIDE,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MAX_MAIN_BYTES,
  MAX_OG_BYTES,
  MIN_LONG_SIDE,
  MIN_QUALITY,
  MIN_SHORT_SIDE,
  OG_LONG_SIDE,
  PROCESS_TIMEOUT_MS,
  QUALITY_STEP,
  RESHRINK_QUALITY,
  SHRINK_FACTOR,
  START_QUALITY,
  THUMB_QUALITY,
  THUMB_WIDTH,
} from "../worker/budget.mjs";

/** Domyślny próg wolnego miejsca (`MEDIA_MIN_FREE_PERCENT`, 5.7). */
export const DEFAULT_MIN_FREE_PERCENT = 15;
