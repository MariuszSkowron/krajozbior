import type { CatalogDeps, PublishedCollection, PublishedPlace } from "./catalog-types";

// Public reads for everyone, a guest included (D-T4): always in the guest
// context, so even a signed-in curator sees here exactly what a guest sees.
// A draft, a withdrawn collection, one of a suspended organization and a
// missing one all give the same `not_found`.

export type PublicReadResult<T> =
  Readonly<{ status: "ok"; value: T }> | Readonly<{ status: "not_found" }>;

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPublishedCollection(
  slug: string,
  deps: CatalogDeps,
): Promise<PublicReadResult<PublishedCollection>> {
  if (!SLUG.test(slug) || slug.length > 80) {
    return { status: "not_found" };
  }

  const found = await deps.withGuestContext((tx) =>
    deps.repository.findPublishedCollection(tx, slug),
  );

  return found === null ? { status: "not_found" } : { status: "ok", value: found };
}

export async function getPublishedPlace(
  placeId: string,
  deps: CatalogDeps,
): Promise<PublicReadResult<PublishedPlace>> {
  if (!UUID.test(placeId)) {
    return { status: "not_found" };
  }

  const found = await deps.withGuestContext((tx) =>
    deps.repository.findPublishedPlace(tx, placeId),
  );

  return found === null ? { status: "not_found" } : { status: "ok", value: found };
}
