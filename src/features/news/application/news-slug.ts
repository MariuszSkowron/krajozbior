// The address of a news item (D-27): made of the title at the first publication, then
// fixed (the database trigger keeps it). The pattern and the length are those of the
// `slug` CHECK of `news_posts` (E7-R1).
export const NEWS_SLUG_MAX_LENGTH = 80;
const FALLBACK_SLUG = "aktualnosc";

/** Lowercase ASCII words of the title joined by hyphens; Polish letters lose their marks. */
export function newsSlugBase(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, NEWS_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");

  return base === "" ? FALLBACK_SLUG : base;
}

/**
 * The first free address for a title: the base, then `-2`, `-3`, ... (the base is cut so
 * that the suffix fits in the limit). `taken` holds the addresses in use.
 */
export function chooseNewsSlug(title: string, taken: ReadonlySet<string>): string {
  const base = newsSlugBase(title);

  if (!taken.has(base)) {
    return base;
  }

  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, NEWS_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, "")}${suffix}`;

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}
