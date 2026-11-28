import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/design-system/components/status-badge";
import { getCuratorCollection } from "@/features/catalog/application/curator-queries";
import { COLLECTION_STATUS_LABELS, REGION_LABELS } from "@/features/catalog/domain/collection";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import { CollectionForm } from "../../collection-form";
import { CollectionVersionProvider } from "../../collection-version";
import { CoverPicker } from "../../cover-picker";
import styles from "../../curator.module.css";
import { pageValue, requireCurator } from "../../curator-session";
import { placeNotice } from "../../place-notice";
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
  searchParams,
}: Readonly<{
  params: Promise<{ collectionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>) {
  const { collectionId } = await params;
  const query = await searchParams;
  const path = `/curator/collections/${collectionId}`;
  const { actor } = await requireCurator(path);
  const { collection, places, otherPlaces, coverPlacePhotoId, coverCandidates, autoCoverPhotoId } =
    pageValue(await getCuratorCollection(actor, collectionId, getCatalogDeps()), path);

  return (
    <CollectionVersionProvider version={collection.version}>
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
            {collection.extraRegions.length > 0 ? (
              <p className={styles.muted}>
                Także w:{" "}
                {collection.extraRegions.map((region) => REGION_LABELS[region]).join(" · ")}.
                Zmienisz to w pliku kolekcji.
              </p>
            ) : null}
            {collection.status === "published" ? (
              <p>
                <Link href={`/collections/${collection.slug}`} target="_blank" rel="noopener">
                  Zobacz stronę kolekcji
                </Link>{" "}
                <span className={styles.muted}>(otworzy się w nowej karcie)</span>
              </p>
            ) : (
              <p className={styles.muted}>
                Szkic nie ma jeszcze strony publicznej. Stronę kolekcji zobaczysz tu po publikacji.
              </p>
            )}
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
              hasExtraRegions: collection.extraRegions.length > 0,
            }}
          />
        </section>

        <PlaceList
          collectionId={collection.id}
          places={places.map(({ id, name, address }) => ({ id, name, address }))}
          otherPlaces={otherPlaces}
          notice={placeNotice(
            query,
            places.map((place) => place.id),
          )}
        />

        <CoverPicker
          collectionId={collection.id}
          currentPhotoId={coverPlacePhotoId}
          choices={coverCandidates}
          autoPhotoId={autoCoverPhotoId}
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
    </CollectionVersionProvider>
  );
}
