// Collection address (D-T8): the title in ASCII plus a random suffix, made on
// the server, never accepted from a curator, so a conflict never tells who
// owns a draft of that name.

export const COLLECTION_SLUG_SUFFIX_LENGTH = 6;
export const COLLECTION_SLUG_BASE_MAX_LENGTH = 60;
export const COLLECTION_SLUG_FALLBACK = "kolekcja";

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Lowercase ASCII words joined by hyphens; Polish letters lose their marks. */
export function slugBase(title: string): string {
  const ascii = title
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COLLECTION_SLUG_BASE_MAX_LENGTH)
    .replace(/-+$/g, "");

  return ascii === "" ? COLLECTION_SLUG_FALLBACK : ascii;
}

/**
 * `random` returns an integer in [0, max) (e.g. `crypto.randomInt`), so tests
 * can fix it. Each call gives a new suffix: a conflict means "draw again".
 */
export function generateCollectionSlug(title: string, random: (max: number) => number): string {
  let suffix = "";

  for (let i = 0; i < COLLECTION_SLUG_SUFFIX_LENGTH; i += 1) {
    suffix += SUFFIX_ALPHABET[random(SUFFIX_ALPHABET.length)];
  }

  return `${slugBase(title)}-${suffix}`;
}
