import type { CollectionStatus } from "./collection";

// Rules of publishing and deleting a collection (D-15). The database enforces
// the dates and the DELETE policy; these functions give the use cases the
// reason to answer with (422 / 409) before the statement runs.

export type PublishDecision =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "already_published" | "no_places" }>;

export function canPublish(status: CollectionStatus, placeCount: number): PublishDecision {
  if (status === "published") {
    return { ok: false, reason: "already_published" };
  }

  return placeCount >= 1 ? { ok: true } : { ok: false, reason: "no_places" };
}

export function canUnpublish(status: CollectionStatus): boolean {
  return status === "published";
}

export type DeleteDecision =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: "was_published" }>;

// Only a draft that was never published may be deleted: explorers may have
// saved it, and a withdrawn collection comes back on the next publication.
export function canDeleteDraft(
  status: CollectionStatus,
  firstPublishedAt: Date | string | null,
): DeleteDecision {
  return status === "draft" && firstPublishedAt === null
    ? { ok: true }
    : { ok: false, reason: "was_published" };
}
