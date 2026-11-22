import type { Actor } from "@/features/identity/domain/actor";

import { isUuid } from "../domain/uuid";
import type { CatalogDeps, CuratorOutcome } from "./catalog-types";
import { admitCurator, inCuratorContext } from "./curator-runner";

// The curator chooses the cover of a collection (E4-3, docs#39 AC1). Only a ready, visible photo
// of a place that is in this collection can be the cover: the use case reads the choice in the
// curator's own context and the database (trigger `collections_cover_guard`) decides again, so a
// photo of another organization, a hidden or unfinished one and a missing one all give the same
// `unprocessable` answer (nothing says whether such a photo exists).

export type SetCoverInput = Readonly<{ placePhotoId?: unknown }>;

export type CoverOutcome = Readonly<{ coverPlacePhotoId: string | null }>;

export async function setCollectionCover(
  actor: Actor | null,
  collectionId: string,
  input: SetCoverInput,
  deps: CatalogDeps,
): Promise<CuratorOutcome<CoverOutcome>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  // `{}` (or `null`) clears the cover; anything but a UUID is invalid.
  const photoId = input.placePhotoId ?? null;

  if (photoId !== null && (typeof photoId !== "string" || !isUuid(photoId))) {
    return { status: "invalid", errors: ["placePhotoId"] };
  }

  return inCuratorContext<CoverOutcome>(admitted.actor, deps, async (tx) => {
    const result = await deps.repository.setCollectionCover(tx, collectionId, photoId);

    if (result === "rejected") {
      return { status: "unprocessable", reason: "cover_not_allowed" } as const;
    }

    return result
      ? ({ status: "ok", value: { coverPlacePhotoId: photoId } } as const)
      : ({ status: "not_found" } as const);
  });
}
