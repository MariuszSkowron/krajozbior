import type { Actor } from "@/features/identity/domain/actor";

import type {
  CatalogDeps,
  CuratorCollectionDetail,
  CuratorCollectionSummary,
  CuratorOutcome,
  CuratorPlaceItem,
} from "./catalog-types";
import { admitCuratorRead, inCuratorContext } from "./curator-runner";

// Reads of the curator panel (PR3). They run in the user context of the actor,
// so the row policies decide what exists for them: a draft of another
// organization is `not_found`, exactly like a missing id (nothing says it
// exists). The organization id of a list comes from the caller only as a
// choice among the actor's own memberships and is checked here.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listCuratorCollections(
  actor: Actor | null,
  organizationId: string,
  deps: CatalogDeps,
): Promise<CuratorOutcome<readonly CuratorCollectionSummary[]>> {
  const admitted = admitCuratorRead(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return inCuratorContext<readonly CuratorCollectionSummary[]>(
    admitted.actor,
    deps,
    async (tx, organizationIds) => {
      if (!organizationIds.includes(organizationId)) {
        return { status: "not_found" } as const;
      }

      return {
        status: "ok",
        value: await deps.repository.listOrganizationCollections(tx, organizationId),
      } as const;
    },
  );
}

export async function getCuratorCollection(
  actor: Actor | null,
  collectionId: string,
  deps: CatalogDeps,
): Promise<CuratorOutcome<CuratorCollectionDetail>> {
  const admitted = admitCuratorRead(actor);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!UUID.test(collectionId)) {
    return { status: "not_found" };
  }

  return inCuratorContext<CuratorCollectionDetail>(admitted.actor, deps, async (tx) => {
    const collection = await deps.repository.findEditableCollection(tx, collectionId);

    if (collection === null) {
      return { status: "not_found" } as const;
    }

    const [places, otherPlaces] = await Promise.all([
      deps.repository.listCollectionPlaces(tx, collectionId),
      deps.repository.listPlacesOutsideCollection(tx, collection.organizationId, collectionId),
    ]);

    return { status: "ok", value: { collection, places, otherPlaces } } as const;
  });
}

// A place of a collection: both must be the actor's, and the place must be in
// that collection, otherwise `not_found`.
export async function getCuratorPlace(
  actor: Actor | null,
  collectionId: string,
  placeId: string,
  deps: CatalogDeps,
): Promise<
  CuratorOutcome<
    Readonly<{ collection: CuratorCollectionDetail["collection"]; place: CuratorPlaceItem }>
  >
> {
  const detail = await getCuratorCollection(actor, collectionId, deps);

  if (detail.status !== "ok") {
    return detail;
  }

  const place = detail.value.places.find((item) => item.id === placeId);

  return place === undefined
    ? { status: "not_found" }
    : { status: "ok", value: { collection: detail.value.collection, place } };
}
