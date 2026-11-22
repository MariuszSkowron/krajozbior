import type { Metadata } from "next";
import Link from "next/link";

import { getCuratorPlace } from "@/features/catalog/application/curator-queries";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import styles from "../../../../curator.module.css";
import { pageValue, requireCurator } from "../../../../curator-session";
import { PlaceForm } from "../../../../place-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edycja miejsca — Krajozbiór" };

// The editor of one place of a collection. A place that is not in this
// collection, or not the curator's, is "Nie znaleziono" like a missing one.
export default async function PlaceEditorPage({
  params,
}: Readonly<{ params: Promise<{ collectionId: string; placeId: string }> }>) {
  const { collectionId, placeId } = await params;
  const path = `/curator/collections/${collectionId}/places/${placeId}`;
  const { actor } = await requireCurator(path);
  const { collection, place } = pageValue(
    await getCuratorPlace(actor, collectionId, placeId, getCatalogDeps()),
    path,
  );

  return (
    <>
      <nav className={styles.breadcrumb} aria-label="Ścieżka">
        <ol>
          <li>
            <Link href="/curator">Kolekcje</Link>
          </li>
          <li>
            <Link href={`/curator/collections/${collection.id}`}>{collection.title}</Link>
          </li>
          <li aria-current="page">{place.name}</li>
        </ol>
      </nav>
      <header className={styles.pageHead}>
        <div>
          <p className="eyebrow">
            {collection.title}: miejsce nr {place.position}
          </p>
          <h1>{place.name}</h1>
        </div>
      </header>
      <PlaceForm
        mode="edit"
        collectionId={collection.id}
        place={{
          id: place.id,
          name: place.name,
          description: place.description,
          address: place.address,
          accessInfo: place.accessInfo,
          accessRestriction: place.accessRestriction,
          latitude: place.latitude,
          longitude: place.longitude,
          visitRadiusM: place.visitRadiusM,
          version: place.version,
        }}
      />
    </>
  );
}
