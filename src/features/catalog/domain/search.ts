import { REGIONS, REGION_LABELS, isRegion, type Region } from "./collection";

// Rules of the public search (E12-2, D-E12-3) that need no database. The same
// character table is spelled in the SQL of the repository (`foldSql`), so the
// phrase and the stored text are folded alike: Polish letters (capital and small)
// become ASCII first, and only then are letters lowered. Lowering ASCII works in
// every collation of the database, `lower('Ł')` does not (C/POSIX).

/** The Polish letters and their ASCII twins, position by position (one table for SQL and TypeScript). */
export const POLISH_LETTERS = "ĄĆĘŁŃÓŚŹŻąćęłńóśźż";
export const ASCII_TWINS = "ACELNOSZZacelnoszz";

/**
 * Capitals of other Latin alphabets and their small letters (Müller, Čapek, Škoda): spelled
 * out in the same table, so SQL does not depend on the collation. `lower()` in the C
 * collation lowers only ASCII, in a UTF-8 collation every letter; with the table both agree
 * on these letters. Letters outside both tables (e.g. Greek) are lowered by TypeScript but
 * not necessarily by a C-collation database: a known, documented limit (D-E12-3).
 */
export const LATIN_CAPITALS = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÔÕÖØÙÚÛÜÝČĎĚŇŘŠŤŮŽ";
export const LATIN_SMALLS = "àáâãäåçèéêëìíîïñòôõöøùúûüýčďěňřšťůž";

const FROM_LETTERS = POLISH_LETTERS + LATIN_CAPITALS;
const TO_LETTERS = ASCII_TWINS + LATIN_SMALLS;

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 80;
/** At most this many collections and this many places are shown; the query reads one more. */
export const SEARCH_RESULT_LIMIT = 20;
/** Time budget of the whole search request, both queries together (D-E12-10), in milliseconds. */
export const SEARCH_TIME_BUDGET_MS = 2000;

/**
 * The time left for the next query: `statement_timeout` counts one statement, so the second
 * query gets the budget minus what the first one used (at least 1 ms, a whole number).
 */
export function remainingBudgetMs(budgetMs: number, elapsedMs: number): number {
  return Math.max(1, Math.floor(budgetMs - elapsedMs));
}

/** At most this many searches run at once in one process (D-E12-10, m1); the rest get "busy". */
export const SEARCH_MAX_CONCURRENT = 4;
/** How long a request waits for a free place before the page says "busy". */
export const SEARCH_QUEUE_WAIT_MS = 1500;

const TWIN_OF = new Map(Array.from(FROM_LETTERS, (letter, index) => [letter, TO_LETTERS[index]]));

/**
 * NFC, Polish letters to ASCII, then lower case. Text stored in NFD (a letter and a
 * separate accent) is not folded by the database, which is why a phrase is folded the
 * same way and not decomposed.
 */
export function foldSearchText(text: string): string {
  return Array.from(text.normalize("NFC"), (letter) => TWIN_OF.get(letter) ?? letter)
    .join("")
    .toLowerCase();
}

/** The SQL twin of `foldSearchText` for a column (the table is a constant, never user input). */
export function foldSql(column: string): string {
  return `lower(translate(${column}, '${FROM_LETTERS}', '${TO_LETTERS}'))`;
}

/** `%`, `_` and `\` lose their meaning in a `like` pattern (`escape '\'`). */
export function escapeLikeText(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export type SearchPhrase =
  | Readonly<{ status: "none" }>
  | Readonly<{ status: "too_short" }>
  | Readonly<{ status: "too_long" }>
  | Readonly<{
      status: "ok";
      /** The phrase as typed, spaces collapsed: shown back to the user. */
      display: string;
      /** The folded phrase: compared with the folded texts. */
      folded: string;
      /** `like` patterns on the folded texts: contains, and starts with. */
      contains: string;
      prefix: string;
    }>;

/**
 * Trims and collapses the spaces of a phrase from the address, then checks its length (2-80).
 * Control characters (Unicode Cc, NUL included) count as spaces: PostgreSQL refuses a NUL in
 * text, so it never reaches the database (LIVE-6).
 */
export function parseSearchPhrase(raw: string | undefined): SearchPhrase {
  const display = (raw ?? "")
    .normalize("NFC")
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  const length = Array.from(display).length;

  if (length === 0) {
    return { status: "none" };
  }

  if (length < SEARCH_MIN_LENGTH) {
    return { status: "too_short" };
  }

  if (length > SEARCH_MAX_LENGTH) {
    return { status: "too_long" };
  }

  const folded = foldSearchText(display);
  const escaped = escapeLikeText(folded);

  return { status: "ok", display, folded, contains: `%${escaped}%`, prefix: `${escaped}%` };
}

/** A region code from the address, or `null` (an unknown value is ignored, not an error). */
export function parseSearchRegion(raw: string | undefined): Region | null {
  return isRegion(raw) ? raw : null;
}

/** Regions whose name starts with the folded phrase: "pomor" finds Pomorskie. */
export function regionsNamedLike(folded: string): readonly Region[] {
  return REGIONS.filter((region) => foldSearchText(REGION_LABELS[region]).startsWith(folded));
}

/** The adjective after "w województwie" (locative): "W województwie pomorskim". */
export const REGION_LOCATIVE: Readonly<Record<Region, string>> = {
  dolnoslaskie: "dolnośląskim",
  kujawsko_pomorskie: "kujawsko-pomorskim",
  lubelskie: "lubelskim",
  lubuskie: "lubuskim",
  lodzkie: "łódzkim",
  malopolskie: "małopolskim",
  mazowieckie: "mazowieckim",
  opolskie: "opolskim",
  podkarpackie: "podkarpackim",
  podlaskie: "podlaskim",
  pomorskie: "pomorskim",
  slaskie: "śląskim",
  swietokrzyskie: "świętokrzyskim",
  warminsko_mazurskie: "warmińsko-mazurskim",
  wielkopolskie: "wielkopolskim",
  zachodniopomorskie: "zachodniopomorskim",
};

const collator = new Intl.Collator("pl");

/** Titles starting with the phrase first, then the rest; alphabetical (Polish) in each group; at most `limit`. */
export function rankSearchHits<T>(
  hits: readonly T[],
  title: (hit: T) => string,
  folded: string,
  limit: number,
): T[] {
  const starts = (hit: T) => foldSearchText(title(hit)).startsWith(folded);

  return [...hits]
    .sort((a, b) => Number(starts(b)) - Number(starts(a)) || collator.compare(title(a), title(b)))
    .slice(0, limit);
}

/** Alphabetical (Polish) order of titles, for the list of all collections. */
export function sortByTitle<T>(items: readonly T[], title: (item: T) => string): T[] {
  return [...items].sort((a, b) => collator.compare(title(a), title(b)));
}

function plural(count: number, one: string, few: string, many: string): string {
  const lastTwo = count % 100;
  const last = count % 10;

  if (count === 1) {
    return one;
  }

  return last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? few : many;
}

/** "1 kolekcja", "3 kolekcje", "5 kolekcji" (nominative). */
export function formatCollectionCount(count: number): string {
  return `${count} ${plural(count, "kolekcja", "kolekcje", "kolekcji")}`;
}

/** "Znaleziono 3 kolekcje i 5 miejsc" (accusative, the Polish plural of both numbers). */
export function describeFound(collections: number, places: number): string {
  const parts = [
    collections > 0
      ? `${collections} ${plural(collections, "kolekcję", "kolekcje", "kolekcji")}`
      : "",
    places > 0 ? `${places} ${plural(places, "miejsce", "miejsca", "miejsc")}` : "",
  ].filter((part) => part !== "");

  return parts.length === 0 ? "Nic nie znaleziono" : `Znaleziono ${parts.join(" i ")}`;
}
