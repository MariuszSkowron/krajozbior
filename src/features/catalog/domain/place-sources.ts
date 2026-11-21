// The source of a place (table `place_sources`): the signature of the data the
// place was made from, shown under the description. Pure functions.

export const ATTRIBUTION_MAX_LENGTH = 500;

export type SourceLabel = Readonly<{ label: string; license: string }>;

export type DescriptionMethod = "facts_template" | "curator";

/** The wording of the file ("template") and the one of the database. */
export function descriptionMethodOf(fileMethod: "template" | "curator"): DescriptionMethod {
  return fileMethod === "template" ? "facts_template" : "curator";
}

/**
 * "Label (licence); label (licence)" in the order of the keys. `null` when no
 * key is given (a signature must not be empty). Keys the batch does not list
 * are skipped: the validator refuses them before this runs.
 */
export function composeAttribution(
  keys: readonly string[],
  sources: ReadonlyMap<string, SourceLabel>,
): string | null {
  // A key repeated in the list names its source once.
  const parts = [...new Set(keys)].flatMap((key) => {
    const source = sources.get(key);

    return source === undefined ? [] : [`${source.label} (${source.license})`];
  });

  return parts.length === 0 ? null : parts.join("; ");
}

/** The Wikidata element of a place, from the import key `wd:Q123`; `null` for any other key. */
export function wikidataQidOf(importKey: string): string | null {
  const match = /^wd:(Q[0-9]+)$/.exec(importKey);

  return match === null ? null : match[1]!;
}

export function wikidataUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}
