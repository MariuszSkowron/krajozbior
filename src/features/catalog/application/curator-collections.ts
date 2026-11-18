import type { Actor } from "@/features/identity/domain/actor";

import { generateCollectionSlug } from "../domain/collection-slug";
import { validateCollectionInput } from "../domain/collection";
import { canDeleteDraft, canPublish, canUnpublish } from "../domain/publication";
import type { CatalogDeps, CollectionRow, CuratorOutcome } from "./catalog-types";
import { admitCurator, inCuratorContext } from "./curator-runner";

// Curator use cases for collections (E1). The owner organization is never a
// parameter of the caller's choosing alone: it must be one of the actor's own
// memberships, and the database checks it again in every policy.

const SLUG_ATTEMPTS = 5;

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export type CreateCollectionInput = Readonly<{
  organizationId?: unknown;
  title?: unknown;
  summary?: unknown;
  region?: unknown;
}>;

// A new collection is always a draft; the address is made here.
export async function createCollection(
  actor: Actor | null,
  input: CreateCollectionInput,
  deps: CatalogDeps,
): Promise<CuratorOutcome<CollectionRow>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  const form = validateCollectionInput(input);

  if (!form.ok) {
    return { status: "invalid", errors: form.errors };
  }

  return inCuratorContext<CollectionRow>(admitted.actor, deps, async (tx, organizationIds) => {
    let organizationId: string | undefined;

    if (input.organizationId === undefined) {
      organizationId = organizationIds.length === 1 ? organizationIds[0] : undefined;

      if (organizationId === undefined) {
        return { status: "invalid", errors: ["organizationId"] } as const;
      }
    } else if (
      typeof input.organizationId === "string" &&
      organizationIds.includes(input.organizationId)
    ) {
      organizationId = input.organizationId;
    } else {
      return { status: "forbidden" } as const;
    }

    for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
      const created = await deps.repository.insertCollection(tx, {
        ...form.value,
        organizationId,
        slug: generateCollectionSlug(form.value.title, deps.random),
      });

      if (created !== null) {
        return { status: "ok", value: created } as const;
      }
    }

    throw new Error("Collection slug is taken after repeated draws");
  });
}

export type UpdateCollectionInput = Readonly<{
  title?: unknown;
  summary?: unknown;
  region?: unknown;
  version?: unknown;
}>;

// Partial edit merged with the stored row; the version guards a stale save.
export async function updateCollection(
  actor: Actor | null,
  collectionId: string,
  input: UpdateCollectionInput,
  deps: CatalogDeps,
): Promise<CuratorOutcome<CollectionRow>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isVersion(input.version)) {
    return { status: "invalid", errors: ["version"] };
  }

  const version = input.version;

  return inCuratorContext<CollectionRow>(admitted.actor, deps, async (tx) => {
    const current = await deps.repository.findEditableCollection(tx, collectionId);

    if (current === null) {
      return { status: "not_found" } as const;
    }

    if (current.version !== version) {
      return { status: "conflict", reason: "stale_version" } as const;
    }

    const form = validateCollectionInput({
      title: input.title ?? current.title,
      summary: input.summary ?? current.summary,
      region: input.region ?? current.region,
    });

    if (!form.ok) {
      return { status: "invalid", errors: form.errors } as const;
    }

    const updated = await deps.repository.updateCollection(tx, collectionId, version, form.value);

    return updated === null
      ? ({ status: "conflict", reason: "stale_version" } as const)
      : ({ status: "ok", value: updated } as const);
  });
}

// Draft -> published; needs at least one place. The first publication also
// sets the address from the current title (D-27).
export async function publishCollection(
  actor: Actor | null,
  collectionId: string,
  input: Readonly<{ version?: unknown }>,
  deps: CatalogDeps,
): Promise<CuratorOutcome<CollectionRow>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isVersion(input.version)) {
    return { status: "invalid", errors: ["version"] };
  }

  const version = input.version;

  return inCuratorContext<CollectionRow>(admitted.actor, deps, async (tx) => {
    const current = await deps.repository.findEditableCollection(tx, collectionId, { lock: true });

    if (current === null) {
      return { status: "not_found" } as const;
    }

    if (current.version !== version) {
      return { status: "conflict", reason: "stale_version" } as const;
    }

    const places = await deps.repository.listCollectionPlaceIds(tx, collectionId);
    const decision = canPublish(current.status, places.length);

    if (!decision.ok) {
      return { status: "unprocessable", reason: decision.reason } as const;
    }

    // D-27: a collection that was never published gets its address from the
    // title it has now, so a working name never reaches a public link. Once
    // published, the address stays (also after a withdrawal): links keep working.
    if (current.firstPublishedAt === null) {
      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
        const first = await deps.repository.publishFirstTime(
          tx,
          collectionId,
          version,
          generateCollectionSlug(current.title, deps.random),
        );

        if (first !== "slug_taken") {
          return first === null
            ? ({ status: "conflict", reason: "stale_version" } as const)
            : ({ status: "ok", value: first } as const);
        }
      }

      throw new Error("Collection slug is taken after repeated draws");
    }

    const updated = await deps.repository.setCollectionStatus(
      tx,
      collectionId,
      version,
      "published",
    );

    return updated === null
      ? ({ status: "conflict", reason: "stale_version" } as const)
      : ({ status: "ok", value: updated } as const);
  });
}

// Published -> draft. Saves and visits of explorers stay; they come back on
// the next publication.
export async function unpublishCollection(
  actor: Actor | null,
  collectionId: string,
  input: Readonly<{ version?: unknown }>,
  deps: CatalogDeps,
): Promise<CuratorOutcome<CollectionRow>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  if (!isVersion(input.version)) {
    return { status: "invalid", errors: ["version"] };
  }

  const version = input.version;

  return inCuratorContext<CollectionRow>(admitted.actor, deps, async (tx) => {
    const current = await deps.repository.findEditableCollection(tx, collectionId, { lock: true });

    if (current === null) {
      return { status: "not_found" } as const;
    }

    if (current.version !== version) {
      return { status: "conflict", reason: "stale_version" } as const;
    }

    if (!canUnpublish(current.status)) {
      return { status: "unprocessable", reason: "not_published" } as const;
    }

    const updated = await deps.repository.setCollectionStatus(tx, collectionId, version, "draft");

    return updated === null
      ? ({ status: "conflict", reason: "stale_version" } as const)
      : ({ status: "ok", value: updated } as const);
  });
}

// Only a draft that was never published can be deleted (D-15).
export async function deleteDraftCollection(
  actor: Actor | null,
  collectionId: string,
  deps: CatalogDeps,
): Promise<CuratorOutcome<null>> {
  const admitted = await admitCurator(actor, deps);

  if ("refusal" in admitted) {
    return admitted.refusal;
  }

  return inCuratorContext<null>(admitted.actor, deps, async (tx) => {
    const current = await deps.repository.findEditableCollection(tx, collectionId, { lock: true });

    if (current === null) {
      return { status: "not_found" } as const;
    }

    if (!canDeleteDraft(current.status, current.firstPublishedAt).ok) {
      return { status: "conflict", reason: "was_published" } as const;
    }

    return (await deps.repository.deleteCollection(tx, collectionId))
      ? ({ status: "ok", value: null } as const)
      : ({ status: "conflict", reason: "was_published" } as const);
  });
}
