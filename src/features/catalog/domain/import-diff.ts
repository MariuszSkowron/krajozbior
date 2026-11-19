import type { CollectionInput, CollectionStatus } from "./collection";
import type { PlaceInput } from "./place";

// Pure decisions of loading an approved collection file: what to do with one
// place or collection, given the file and the stored state. No database, so
// the same rules serve the preview and the real load. The load always decides
// again under the lock (a preview is only information).

/** What the key table remembers about an entity loaded earlier. */
export type ImportKeyState = Readonly<{
  entityId: string;
  importedVersion: number;
  /** Composition of a collection as the loader left it; `null` for a place. */
  importedPlaces: readonly string[] | null;
}>;

export type StoredPlace = Readonly<{ version: number; content: PlaceInput }>;

export type PlaceDecision =
  "create" | "noop" | "update" | "kept_manual_edit" | "kept_manual_delete";

function samePlaceContent(a: PlaceInput, b: PlaceInput): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.address === b.address &&
    a.accessInfo === b.accessInfo &&
    Number(a.latitude) === Number(b.latitude) &&
    Number(a.longitude) === Number(b.longitude) &&
    Number(a.visitRadiusM) === Number(b.visitRadiusM)
  );
}

/**
 * `key` undefined: never loaded. `stored` null: the entity is gone or not
 * visible (a curator deleted it): the owner's deletion wins, it is not
 * created again. A version other than the loaded one: edited in the panel.
 */
export function decidePlace(
  key: ImportKeyState | undefined,
  stored: StoredPlace | null,
  wanted: PlaceInput,
): PlaceDecision {
  if (key === undefined) {
    return "create";
  }
  if (stored === null) {
    return "kept_manual_delete";
  }
  if (stored.version !== key.importedVersion) {
    return "kept_manual_edit";
  }

  return samePlaceContent(stored.content, wanted) ? "noop" : "update";
}

export type StoredCollection = Readonly<{
  version: number;
  status: CollectionStatus;
  /** Set once the collection was published, also after a withdrawal. */
  firstPublishedAt: Date | string | null;
  content: CollectionInput;
  placeIds: readonly string[];
}>;

export type CollectionContentDecision =
  | "create"
  | "noop"
  | "update"
  | "kept_manual_edit"
  | "kept_manual_delete"
  | "skipped_already_published";

export type CompositionDecision =
  "sync" | "kept_manual_edit" | "kept_manual_delete" | "skipped_already_published";

export type CollectionDecision = Readonly<{
  content: CollectionContentDecision;
  composition: CompositionDecision;
}>;

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Title, summary and region follow the file only in a draft whose version is
 * the loaded one. Composition and order also need the places to be as the
 * loader left them: adding, removing and reordering in the panel does not
 * raise the version, so the stored list shows it.
 */
export function decideCollection(
  key: ImportKeyState | undefined,
  stored: StoredCollection | null,
  wanted: CollectionInput,
): CollectionDecision {
  if (key === undefined) {
    return { content: "create", composition: "sync" };
  }
  if (stored === null) {
    return { content: "kept_manual_delete", composition: "kept_manual_delete" };
  }
  // Published at any time (a withdrawn draft too): content and composition stay.
  // The loader records the version it left after publishing, so a version that
  // differs means the owner edited it in the panel since.
  if (stored.status === "published" || stored.firstPublishedAt !== null) {
    const edited = stored.version !== key.importedVersion;
    const kind = edited ? "kept_manual_edit" : "skipped_already_published";

    return { content: kind, composition: kind };
  }

  const untouched = stored.version === key.importedVersion;
  const sameComposition = sameIds(stored.placeIds, key.importedPlaces ?? []);
  const composition = untouched && sameComposition ? "sync" : "kept_manual_edit";

  if (!untouched) {
    return { content: "kept_manual_edit", composition };
  }

  const same =
    stored.content.title === wanted.title &&
    stored.content.summary === wanted.summary &&
    stored.content.region === wanted.region;

  return { content: same ? "noop" : "update", composition };
}

export type CompositionDiff = Readonly<{
  remove: readonly string[];
  add: readonly string[];
  reorder: boolean;
}>;

/** Steps that turn `current` into `desired`: remove, append the missing in file order, reorder. */
export function diffComposition(
  current: readonly string[],
  desired: readonly string[],
): CompositionDiff {
  const wanted = new Set(desired);
  const present = new Set(current);
  const remove = current.filter((id) => !wanted.has(id));
  const add = desired.filter((id) => !present.has(id));
  const after = [...current.filter((id) => wanted.has(id)), ...add];

  return { remove, add, reorder: !sameIds(after, desired) };
}
