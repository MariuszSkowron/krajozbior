/** From this many saves the curator sees the exact number; fewer is shown as "less than". */
export const SAVE_COUNT_EXACT_FROM = 3;

/**
 * The saves of a collection as the curator sees them. One or two saves could reveal a single
 * explorer, and zero would reveal the moment of the first save, so 0, 1 and 2 show as
 * "mniej niż 3"; 3 or more stay exact (D-62).
 */
export function formatSaveCount(count: number): string {
  if (count < SAVE_COUNT_EXACT_FROM) {
    return `mniej niż ${SAVE_COUNT_EXACT_FROM}`;
  }

  return String(count);
}
