import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/design-system/components/status-badge";
import { getCuratorCollection } from "@/features/catalog/application/curator-queries";
import { COLLECTION_STATUS_LABELS, REGION_LABELS } from "@/features/catalog/domain/collection";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import { CollectionForm } from "../../collection-form";
import { CoverPicker } from "../../cover-picker";
import styles from "../../curator.module.css";
import { pageValue, requireCurator } from "../../curator-session";
import { PlaceList } from "../../place-list";
import { PublicationControls } from "../../publication-controls";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edycja kolekcji — Krajozbiór" };

// The editor of one collection. A collection of another organization, a draft
// of someone else and a missing id all end in the same "Nie znaleziono": the
// use case reads in the curator's own context, so the database shows nothing
// foreign (R-09, D-15).
export default async function CollectionEditorPage({
  params,
}: Readonly<{ params: Promise<{ collectionId: string }> }>) {
  const { collectionId } = await params;
  const path = `/curator/collections/${collectionId}`;
  const { actor } = await requireCurator(path);
  const { collection, places, otherPlaces, coverPlacePhotoId, coverCandidates } = pageValue(
    await getCuratorCollection(actor, collectionId, getCatalogDeps()),
    path,
  );

  return (
    <>
      <nav className={styles.breadcrumb} aria-label="Ścieżka">
        <ol>
          <li>
            <Link href="/curator">Kolekcje</Link>
          </li>
          <li aria-current="page">{collection.title}</li>
        </ol>
      </nav>
      <header className={styles.pageHead}>
        <div>
          <p className="eyebrow">Edycja kolekcji</p>
          <h1>{collection.title}</h1>
          <p>
            <span className={styles.onCard}>
              <StatusBadge tone={collection.status === "published" ? "success" : "neutral"}>
                {COLLECTION_STATUS_LABELS[collection.status]}
              </StatusBadge>
            </span>{" "}
            <span className={styles.muted}>{REGION_LABELS[collection.region]}</span>
          </p>
        </div>
      </header>

      <section aria-labelledby="details-heading" className={styles.section}>
        <h2 id="details-heading">Dane kolekcji</h2>
        <CollectionForm
          mode="edit"
          collection={{
            id: collection.id,
            title: collection.title,
            summary: collection.summary,
            region: collection.region,
            version: collection.version,
          }}
        />
      </section>

      <PlaceList
        collectionId={collection.id}
        places={places.map(({ id, name, address }) => ({ id, name, address }))}
        otherPlaces={otherPlaces}
      />

      <CoverPicker
        collectionId={collection.id}
        currentPhotoId={coverPlacePhotoId}
        choices={coverCandidates}
      />

      <PublicationControls
        collection={{
          id: collection.id,
          title: collection.title,
          version: collection.version,
          status: collection.status,
          wasPublished: collection.firstPublishedAt !== null,
        }}
      />
    </>
  );
}
