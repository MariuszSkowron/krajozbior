import type { Actor } from "@/features/identity/domain/actor";

import { nextPosition, validateReorder } from "../domain/order";
import { validatePlaceInput } from "../domain/place";
import type { CatalogDeps, CuratorOutcome, PlaceRow } from "./catalog-types";
import { admitCurator, inCuratorContext } from "./curator-runner";

// Curator use cases for places and their order in a collection (E1). A place
// always belongs to the organization of the collection it is added to; that
// id comes from the stored collection row, never from the request.

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export type AddPlaceInput = Readonly<Record<string, unknown>>;

// `placeId` links an existing place of the same organization; otherwise the
// fields create a new place and link it. The place goes to the end of the list.
export async function addPlace(
  actor: Actor | null,
  collectionId: string,
  input: AddPlaceInput,
  deps: CatalogDeps,
): Promise<CuratorOutcome<{ placeId: string; position: number }>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const existingId = input.placeId;

  if (existingId !== undefined && !isUuid(existingId)) {
    return { status: "invalid", errors: ["placeId"] };
  }

  const form = existingId === undefined ? validatePlaceInput(input) : null;

  if (form !== null && !form.ok) {
    return { status: "invalid", errors: form.errors };
  }

  return inCuratorContext<{ placeId: string; position: number }>(
    admitted.actor,
    deps,
    async (tx) => {
      // Locks the collection row: two adds cannot take the same position.
      const collection = await deps.repository.findEditableCollection(tx, collectionId, {
        lock: true,
      });

      if (collection === null) {
        return { status: "not_found" } as const;
      }

      let placeId: string;

      if (existingId === undefined) {
        placeId = (
          await deps.repository.insertPlace(
            tx,
            collection.organizationId,
            (form as { ok: true; value: Parameters<typeof deps.repository.insertPlace>[2] }).value,
          )
        ).id;
      } else if (
        await deps.repository.placeInOrganization(tx, existingId, collection.organizationId)
      ) {
        placeId = existingId;
      } else {
        return { status: "not_found" } as const;
      }

      const position = nextPosition(
        await deps.repository.listCollectionPositions(tx, collectionId),
      );
      const linked = await deps.repository.linkPlace(
        tx,
        collectionId,
        placeId,
        collection.organizationId,
        position,
      );

      return linked
        ? ({ status: "ok", value: { placeId, position } } as const)
        : ({ status: "conflict", reason: "already_in_collection" } as const);
    },
  );
}

// Partial edit merged with the stored place; the version guards a stale save.
export async function updatePlace(
  actor: Actor | null,
  placeId: string,
  input: Readonly<Record<string, unknown>>,
  deps: CatalogDeps,
): Promise<CuratorOutcome<PlaceRow>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isVersion(input.version)) {
    return { status: "invalid", errors: ["version"] };
  }

  const version = input.version;

  return inCuratorContext<PlaceRow>(admitted.actor, deps, async (tx) => {
    const current = await deps.repository.findEditablePlace(tx, placeId);

    if (current === null) {
      return { status: "not_found" } as const;
    }

    if (current.version !== version) {
      return { status: "conflict", reason: "stale_version" } as const;
    }

    const form = validatePlaceInput({
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      address: input.address ?? current.address,
      accessInfo: input.accessInfo ?? current.accessInfo,
      latitude: input.latitude ?? current.latitude,
      longitude: input.longitude ?? current.longitude,
      visitRadiusM: input.visitRadiusM ?? current.visitRadiusM,
    });

    if (!form.ok) {
      return { status: "invalid", errors: form.errors } as const;
    }

    const updated = await deps.repository.updatePlace(tx, placeId, version, form.value);

    return updated === null
      ? ({ status: "conflict", reason: "stale_version" } as const)
      : ({ status: "ok", value: updated } as const);
  });
}

// The request lists every place of the collection once, in the new order.
export async function reorderPlaces(
  actor: Actor | null,
  collectionId: string,
  input: Readonly<{ placeIds?: unknown }>,
  deps: CatalogDeps,
): Promise<CuratorOutcome<{ placeIds: readonly string[] }>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return inCuratorContext<{ placeIds: readonly string[] }>(admitted.actor, deps, async (tx) => {
    const collection = await deps.repository.findEditableCollection(tx, collectionId, {
      lock: true,
    });

    if (collection === null) {
      return { status: "not_found" } as const;
    }

    const current = await deps.repository.listCollectionPlaceIds(tx, collectionId);
    const order = validateReorder(current, input.placeIds);

    if (!order.ok) {
      return { status: "invalid", errors: ["placeIds"] } as const;
    }

    await deps.repository.reorderPlaces(tx, collectionId, order.placeIds);

    return { status: "ok", value: { placeIds: order.placeIds } } as const;
  });
}

// Removes the link only; the place and the visits of explorers stay (R-07).
export async function removePlaceFromCollection(
  actor: Actor | null,
  collectionId: string,
  placeId: string,
  deps: CatalogDeps,
): Promise<CuratorOutcome<null>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return inCuratorContext<null>(admitted.actor, deps, async (tx) => {
    const collection = await deps.repository.findEditableCollection(tx, collectionId, {
      lock: true,
    });

    if (collection === null) {
      return { status: "not_found" } as const;
    }

    return (await deps.repository.unlinkPlace(tx, collectionId, placeId))
      ? ({ status: "ok", value: null } as const)
      : ({ status: "not_found" } as const);
  });
}
