import { isUuid } from "@/features/catalog/domain/uuid";
import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { ALBUM_WRITE_ACTION, albumWriteLimit } from "../domain/limits";
import { computeProgress } from "../domain/progress";
import type {
  AlbumDeps,
  AlbumOutcome,
  CollectionProgressView,
  SavedCollectionSummary,
} from "./album-types";

// Saved collections of the explorer (E2, PR6). Every use case takes the actor
// from the session and never a user id: the owner of a row is
// app_current_user_id() in the database, and the row policies are the second
// barrier. Both "explorer" roles of the app (`user`, and `admin` which is
// nothing more than a `user` here, spec section 6) may use the album.

type Refusal = Exclude<AlbumOutcome<never>, { status: "ok" }>;

async function admit(
  actor: Actor | null,
  deps: AlbumDeps,
  { counted }: { counted: boolean },
): Promise<{ actor: Actor } | { refusal: Refusal }> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { refusal: { status: "unauthenticated" } };
    }
    throw error;
  }

  if (counted) {
    const decision = await deps.limiter.reserve(ALBUM_WRITE_ACTION, signedIn.id, albumWriteLimit);

    if (!decision.allowed) {
      return { refusal: { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds } };
    }
  }

  return { actor: signedIn };
}

/**
 * Saves a publicly visible collection. Idempotent: a repeated save is `ok`. A
 * draft, a withdrawn collection, one of a suspended organization and a missing
 * id all give the same `not_found`.
 */
export async function saveCollection(
  actor: Actor | null,
  collectionId: string,
  deps: AlbumDeps,
): Promise<AlbumOutcome<{ saved: true }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    if (!(await deps.repository.isPubliclyVisibleCollection(tx, collectionId))) {
      return { status: "not_found" } as const;
    }

    // The insert tests visibility itself: a collection withdrawn after the check
    // above is `not_found`, not a refusal of the row policy.
    const saved = await deps.repository.saveCollection(tx, collectionId);

    if (saved === "not_found") {
      return { status: "not_found" } as const;
    }

    if (saved === "too_many") {
      return { status: "conflict", reason: "too_many_saved" } as const;
    }

    return { status: "ok", value: { saved: true } } as const;
  });
}

/**
 * Removes the actor's own save. Idempotent and silent about anything else: the
 * answer is the same whether the actor had a save, somebody else did, or the
 * collection does not exist, so it reveals nothing.
 */
export async function unsaveCollection(
  actor: Actor | null,
  collectionId: string,
  deps: AlbumDeps,
): Promise<AlbumOutcome<{ saved: false }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    await deps.repository.unsaveCollection(tx, collectionId);

    return { status: "ok", value: { saved: false } } as const;
  });
}

/** Slugs of the saved, currently published collections: a light read (no places, no progress). */
export async function listMySavedCollectionSlugs(
  actor: Actor | null,
  deps: AlbumDeps,
): Promise<AlbumOutcome<readonly string[]>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const collections = await deps.repository.listSavedCollections(tx);

    return { status: "ok", value: collections.map(({ slug }) => slug) } as const;
  });
}

/** "Moje kolekcje": the saved, currently published collections with X/Y progress, newest save first. */
export async function listMyCollectionsWithProgress(
  actor: Actor | null,
  deps: AlbumDeps,
): Promise<AlbumOutcome<readonly SavedCollectionSummary[]>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const collections = await deps.repository.listSavedCollections(tx);
    const links = await deps.repository.listSavedCollectionPlaces(tx);
    const visited = await deps.repository.listVisitedPlaceIds(tx);

    const placesOf = new Map<string, string[]>();

    for (const { collectionId, placeId } of links) {
      placesOf.set(collectionId, [...(placesOf.get(collectionId) ?? []), placeId]);
    }

    return {
      status: "ok",
      value: collections.map((collection) => ({
        ...collection,
        progress: computeProgress(placesOf.get(collection.id) ?? [], visited),
      })),
    } as const;
  });
}

/** Whether the actor saved the collection, and the actor's progress in it (for the collection page). */
export async function getCollectionProgress(
  actor: Actor | null,
  collectionId: string,
  deps: AlbumDeps,
): Promise<AlbumOutcome<CollectionProgressView>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const saved = await deps.repository.isCollectionSaved(tx, collectionId);
    const placeIds = await deps.repository.listPlaceIdsOfCollection(tx, collectionId);
    const visited = await deps.repository.listVisitedPlaceIdsOfCollection(tx, collectionId);

    return {
      status: "ok",
      value: { saved, progress: computeProgress(placeIds, visited) },
    } as const;
  });
}
