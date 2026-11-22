import { computeProgress } from "@/features/album/domain/progress";
import { isUuid } from "@/features/catalog/domain/uuid";
import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { entryState } from "../domain/entry";
import { OWN_COLLECTION_WRITE_ACTION, ownCollectionWriteLimit } from "../domain/limits";
import { validateOwnCollectionInput } from "../domain/own-collection";
import type {
  OwnCollectionDetail,
  OwnCollectionSummary,
  OwnCollectionsDeps,
  OwnCollectionsOutcome,
} from "./own-collection-types";

// Private collections of the explorer (E8-1a). Every use case takes the actor from the session and
// never a user id: the owner of a row is app_current_user_id() in the database, and the row
// policies are the second barrier. Any signed-in account may keep own collections: `user`, and
// `admin` or a curator, who are nothing more than explorers here (spec E8-S1). Another person's
// collection, entry or id that does not exist all answer `not_found`, so nothing leaks.

type Refusal = Exclude<OwnCollectionsOutcome<never>, { status: "ok" }>;

async function admit(
  actor: Actor | null,
  deps: OwnCollectionsDeps,
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
    const decision = await deps.limiter.reserve(
      OWN_COLLECTION_WRITE_ACTION,
      signedIn.id,
      ownCollectionWriteLimit,
    );

    if (!decision.allowed) {
      return { refusal: { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds } };
    }
  }

  return { actor: signedIn };
}

function bodyField(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/** "Moje" in "Moje kolekcje": the own collections with their progress. */
export async function listOwnCollections(
  actor: Actor | null,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<readonly OwnCollectionSummary[]>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return deps.withUserContext(admitted.actor, async (tx) => ({
    status: "ok" as const,
    value: await deps.repository.listOwn(tx),
  }));
}

/** The page of one own collection: the text, the entries with their state and the progress. */
export async function getOwnCollection(
  actor: Actor | null,
  collectionId: string,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<OwnCollectionDetail>> {
  const admitted = await admit(actor, deps, { counted: false });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const collection = await deps.repository.findOwn(tx, collectionId);

    if (collection === null) {
      return { status: "not_found" } as const;
    }

    const rows = await deps.repository.listEntries(tx, collectionId);
    const entries = rows.map((row) => ({
      ...row,
      state: entryState(row.placeId, row.place === null ? null : row.placeId),
    }));
    // The same rule as the album (D-14): only the places that are public now count.
    const counted = entries.filter((entry) => entry.state === "available");
    const progress = computeProgress(
      counted.map((entry) => entry.placeId as string),
      counted.filter((entry) => entry.visited).map((entry) => entry.placeId as string),
    );

    return {
      status: "ok",
      value: {
        collection,
        entries,
        progress:
          progress.kind === "empty"
            ? { visited: 0, total: 0 }
            : { visited: progress.visited, total: progress.total },
      },
    } as const;
  });
}

export async function createOwnCollection(
  actor: Actor | null,
  body: unknown,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<{ id: string }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const input = validateOwnCollectionInput({
    title: bodyField(body, "title"),
    summary: bodyField(body, "summary"),
    region: bodyField(body, "region"),
  });

  if (!input.ok) {
    return { status: "invalid", errors: input.errors };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const created = await deps.repository.create(tx, input.value);

    return created.status === "created"
      ? ({ status: "ok", value: { id: created.id } } as const)
      : ({ status: "conflict", reason: created.status } as const);
  });
}

export async function updateOwnCollection(
  actor: Actor | null,
  collectionId: string,
  body: unknown,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<{ updated: true }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  const input = validateOwnCollectionInput({
    title: bodyField(body, "title"),
    summary: bodyField(body, "summary"),
    region: bodyField(body, "region"),
  });
  const version = bodyField(body, "version");

  if (!input.ok) {
    return { status: "invalid", errors: input.errors };
  }

  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    // A form always sends the version it was drawn from; a missing or odd one is as good as a stale
    // one: the person is asked to reload instead of being shown "fix the marked fields" with none.
    return { status: "conflict", reason: "stale_version" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const result = await deps.repository.update(tx, collectionId, version, input.value);

    if (result === "not_found") {
      return { status: "not_found" } as const;
    }

    return result === "stale_version"
      ? ({ status: "conflict", reason: "stale_version" } as const)
      : ({ status: "ok", value: { updated: true } } as const);
  });
}

export async function deleteOwnCollection(
  actor: Actor | null,
  collectionId: string,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<{ deleted: true }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) =>
    (await deps.repository.remove(tx, collectionId))
      ? ({ status: "ok", value: { deleted: true } } as const)
      : ({ status: "not_found" } as const),
  );
}

/** Adds a place of the public catalog to the actor's collection; idempotent. */
export async function addPlaceToOwnCollection(
  actor: Actor | null,
  collectionId: string,
  body: unknown,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<{ added: boolean }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const placeId = bodyField(body, "placeId");

  if (!isUuid(placeId)) {
    return { status: "invalid", errors: ["placeId"] };
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) => {
    const result = await deps.repository.addPlace(tx, collectionId, placeId);

    if (result === "not_found") {
      return { status: "not_found" } as const;
    }

    if (result === "too_many_items") {
      return { status: "conflict", reason: "too_many_items" } as const;
    }

    return { status: "ok", value: { added: result === "added" } } as const;
  });
}

/** Removes one entry; also the entry of a place the curator deleted ("Usuń z kolekcji"). */
export async function removeEntryFromOwnCollection(
  actor: Actor | null,
  collectionId: string,
  body: unknown,
  deps: OwnCollectionsDeps,
): Promise<OwnCollectionsOutcome<{ removed: true }>> {
  const admitted = await admit(actor, deps, { counted: true });

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const entryId = bodyField(body, "itemId");

  if (!isUuid(entryId)) {
    return { status: "invalid", errors: ["itemId"] };
  }

  if (!isUuid(collectionId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(admitted.actor, async (tx) =>
    (await deps.repository.removeEntry(tx, collectionId, entryId))
      ? ({ status: "ok", value: { removed: true } } as const)
      : ({ status: "not_found" } as const),
  );
}
