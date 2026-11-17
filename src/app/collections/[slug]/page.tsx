import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { getCollectionProgress } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import { getPublishedCollection } from "@/features/catalog/application/public-catalog";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import { CollectionProgress } from "../../my/collections/collection-progress";
import albumStyles from "../../my/collections/collections.module.css";
import styles from "../../catalog.module.css";
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

    return view.status === "ok"
      ? ({ kind: "explorer", saved: view.value.saved, progress: view.value.progress } as const)
      : ({ kind: "none" } as const);
  } catch (error) {
    logReadFailure("Collection album read", error);

    return { kind: "none" } as const;
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
        <h1>{collection.title}</h1>
        <p className={styles.meta}>
          {REGION_LABELS[collection.region]} · Prowadzi: {collection.organization.name}
        </p>
        {collection.summary === "" ? null : <p className={styles.summary}>{collection.summary}</p>}
        {album.kind === "guest" ? (
          <div>
            <Link className={albumStyles.action} href={album.loginHref}>
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
              progress={album.progress}
              label={`Twój postęp w kolekcji ${collection.title}`}
            />
          </>
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
        ) : (
          <ol className={styles.list}>
            {collection.places.map((place) => (
              <li key={place.id} className={styles.item}>
                <Link className={styles.itemLink} href={`/places/${place.id}`}>
                  <span className={styles.itemTitle}>
                    {place.position}. {place.name}
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
