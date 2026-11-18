import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { CollectionProgress } from "@/design-system/components/collection-progress";
import { getCollectionProgress } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import { progressCounts } from "@/features/album/domain/progress";
import { getPublishedCollection } from "@/features/catalog/application/public-catalog";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { listMyVisitKindsOfCollection } from "@/features/visits/application/mark-past-visits";
import { getVisitDeps } from "@/features/visits/infrastructure/visit-deps";

import albumStyles from "../../my/collections/collections.module.css";
import styles from "../../catalog.module.css";
import { CollectionPlaces } from "./collection-places";
import { SaveCollectionButton } from "./save-collection-button";

// Rendered on every request and never cached by a shared cache (src/proxy.ts
// sets `Cache-Control: private, no-store`): later this page also shows the
// signed-in explorer's progress, which must not reach anyone else.
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// The page and its title share one read per request. A guest read: a draft, a
// withdrawn collection, one of an unapproved organization and a missing slug all
// give `not_found`. A failure of the database is `failed`, never a 404.
const load = cache(async (slug: string) => {
  try {
    return await getPublishedCollection(slug, getCatalogDeps());
  } catch (error) {
    logReadFailure("Public collection read", error);

    return { status: "failed" } as const;
  }
});

// What the page adds for the visitor: a guest is sent to sign in and back here;
// a signed-in explorer gets the save button and their own progress. A failure
// of the album read (or of the session lookup) leaves the public page whole,
// without the personal part, and is logged by class only.
async function loadAlbum(collectionId: string, slug: string) {
  try {
    const actor = await getRequestActor();

    if (actor === null) {
      return { kind: "guest", loginHref: loginHref(`/collections/${slug}`) } as const;
    }

    const view = await getCollectionProgress(actor, collectionId, getAlbumDeps());

    if (view.status !== "ok") {
      return { kind: "none" } as const;
    }

    // The kinds of the explorer's visits mark the places in the list. A failed
    // read leaves the plain list (kinds: null), like the failures above.
    let kinds: Map<string, "on_site" | "past"> | null = null;

    try {
      const answer = await listMyVisitKindsOfCollection(actor, collectionId, getVisitDeps());

      kinds =
        answer.status === "ok"
          ? new Map(answer.value.map((visit) => [visit.placeId, visit.kind]))
          : null;
    } catch (error) {
      logReadFailure("Collection visit kinds read", error);
    }

    return {
      kind: "explorer",
      saved: view.value.saved,
      progress: view.value.progress,
      kinds,
    } as const;
  } catch (error) {
    logReadFailure("Collection album read", error);

    return { kind: "unavailable" } as const;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await load((await params).slug);

  return result.status === "ok" ? { title: `${result.value.title} — Krajozbiór` } : {};
}

export default async function CollectionPage({ params }: { params: Params }) {
  const result = await load((await params).slug);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "failed") {
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("Public collection read failed");
  }

  const collection = result.value;
  const album = await loadAlbum(collection.id, collection.slug);

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1 className={styles.collectionTitle}>{collection.title}</h1>
        <p className={styles.meta}>
          <span className={styles.itemMetaMono}>{REGION_LABELS[collection.region]}</span> ·
          Prowadzi: {collection.organization.name}
        </p>
        {collection.summary === "" ? null : <p className={styles.summary}>{collection.summary}</p>}
        {album.kind === "guest" ? (
          <div className={albumStyles.guestAction}>
            <Link className="button button--primary" href={album.loginHref}>
              Zapisz kolekcję
            </Link>
            <p className={albumStyles.feedback}>
              Aby zapisać kolekcję, zalogujesz się i wrócisz tutaj.
            </p>
          </div>
        ) : album.kind === "explorer" ? (
          <>
            <SaveCollectionButton collectionId={collection.id} initialSaved={album.saved} />
            <CollectionProgress
              {...progressCounts(album.progress)}
              label={`Twój postęp w kolekcji ${collection.title}`}
            />
          </>
        ) : album.kind === "unavailable" ? (
          <p className={albumStyles.feedback}>
            Nie udało się wczytać Twojego zapisu tej kolekcji. Odśwież stronę za chwilę.
          </p>
        ) : null}
      </header>
      <section className={styles.section} aria-labelledby="miejsca">
        <h2 id="miejsca">
          {collection.places.length === 0
            ? "Miejsca w kolekcji"
            : `Miejsca w kolekcji (${collection.places.length})`}
        </h2>
        {collection.places.length === 0 ? (
          <p>Ta kolekcja nie ma jeszcze miejsc.</p>
        ) : album.kind === "explorer" && album.kinds !== null ? (
          <CollectionPlaces
            places={collection.places.map((place) => ({
              id: place.id,
              name: place.name,
              address: place.address,
              position: place.position,
              kind: album.kinds?.get(place.id) ?? null,
            }))}
          />
        ) : (
          <ol className={styles.list}>
            {collection.places.map((place) => (
              <li key={place.id} className={styles.item}>
                <Link className={styles.itemLink} href={`/places/${place.id}`}>
                  <span className={styles.itemTitle}>
                    <span className={styles.itemNumber}>{place.position}.</span> {place.name}
                  </span>
                  {place.address === "" ? null : (
                    <span className={styles.itemMeta}>{place.address}</span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
