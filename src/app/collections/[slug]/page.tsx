import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { getCollectionProgress } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import { progressCounts } from "@/features/album/domain/progress";
import { getPublishedCollection } from "@/features/catalog/application/public-catalog";
import {
  STATE_FILTERS,
  STATE_FILTER_LABELS,
  albumHref,
  countByState,
  filterByState,
  formatUpdateDate,
  parseStateFilter,
  parseView,
  type VisitKind,
} from "@/features/catalog/domain/album-view";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { ogCoverDescription, ogImageUrl } from "@/features/catalog/domain/collection-cover";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { listMyVisitKindsOfCollection } from "@/features/visits/application/mark-past-visits";
import { getVisitDeps } from "@/features/visits/infrastructure/visit-deps";

import albumStyles from "../../my/collections/collections.module.css";
import styles from "../../catalog.module.css";
import panelStyles from "./album.module.css";
import mapStyles from "./collection-map.module.css";
import { CollectionCover, CoverProgress } from "./collection-cover";
import { CollectionMapLoader } from "./collection-map-loader";
import { CollectionPlaces } from "./collection-places";
import { PlaceTile } from "./place-tile";
import { SaveCollectionButton } from "./save-collection-button";

// Rendered on every request and never cached by a shared cache (src/proxy.ts
// sets `Cache-Control: private, no-store`): later this page also shows the
// signed-in explorer's progress, which must not reach anyone else.
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
    let kinds: Map<string, VisitKind> | null = null;

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
      actor,
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

  if (result.status !== "ok") {
    return {};
  }

  const title = `${result.value.title} — Krajozbiór`;
  // Podgląd linku ze zdjęciem (E4-3, Q18): `og:image` z okładki, JPEG 1200 px. Adres bezwzględny
  // z `BETTER_AUTH_URL`; bez okładki albo bez tego adresu strona zostaje bez obrazu.
  const image = ogImageUrl(process.env.BETTER_AUTH_URL, result.value.cover);

  const cover = result.value.cover;

  if (image === null || cover === null) {
    return { title };
  }

  // Autor i licencja w opisie podglądu (licencje CC wymagają uznania autorstwa); `alt` obrazu to
  // opis zdjęcia.
  const description = ogCoverDescription(cover);

  return {
    title,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, alt: cover.altText }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams?: SearchParams;
}) {
  const result = await load((await params).slug);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "failed") {
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("Public collection read failed");
  }

  const collection = result.value;
  const query = (await searchParams) ?? {};
  const album = await loadAlbum(collection.id, collection.slug);
  const kinds = album.kind === "explorer" ? album.kinds : null;
  const stan = kinds === null ? "wszystkie" : parseStateFilter(query.stan);
  const widok = parseView(query.widok);
  const shown = kinds === null ? collection.places : filterByState(collection.places, stan, kinds);
  const counts =
    kinds === null
      ? null
      : countByState(
          collection.places.map((place) => place.id),
          kinds,
        );

  return (
    <div className={`content-width-wide ${styles.page}`}>
      <CollectionCover
        cover={collection.cover}
        eyebrow={`Kolekcja · ${REGION_LABELS[collection.region]}`}
      >
        <h1>{collection.title}</h1>
        {album.kind === "explorer" ? (
          <CoverProgress
            {...progressCounts(album.progress)}
            label={`Twój postęp w kolekcji ${collection.title}`}
          />
        ) : null}
      </CollectionCover>
      <div className={panelStyles.intro}>
        <div className={panelStyles.introText}>
          {collection.summary === "" ? null : (
            <p className={styles.summary}>{collection.summary}</p>
          )}
          <p className={panelStyles.curator}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
            </svg>
            Kurator: {collection.organization.name}
          </p>
          <p className={panelStyles.updated}>
            {formatPlaceCount(collection.placeCount)} · aktualizacja{" "}
            {formatUpdateDate(collection.contentUpdatedAt)}
          </p>
        </div>
        {album.kind === "guest" ? (
          <div className={`${albumStyles.guestAction} ${panelStyles.introAction}`}>
            <Link className="button button--primary" href={album.loginHref}>
              Zaloguj się, aby zapisać kolekcję
            </Link>
            <p className={albumStyles.feedback}>Po zalogowaniu wrócisz tutaj.</p>
          </div>
        ) : album.kind === "explorer" ? (
          <div className={panelStyles.introAction}>
            <SaveCollectionButton collectionId={collection.id} initialSaved={album.saved} />
          </div>
        ) : album.kind === "unavailable" ? (
          <p className={`${albumStyles.feedback} ${panelStyles.introAction}`}>
            Nie udało się sprawdzić, czy ta kolekcja jest zapisana. Odśwież stronę za chwilę.
          </p>
        ) : null}
      </div>
      <section className={`${styles.section} ${panelStyles.places}`} aria-labelledby="miejsca">
        <div className={panelStyles.listHead}>
          <h2 id="miejsca">
            {collection.places.length === 0
              ? "Miejsca w kolekcji"
              : `Miejsca w kolekcji (${collection.places.length})`}
          </h2>
          {collection.places.length === 0 ? null : (
            <nav className={panelStyles.segment} aria-label="Widok miejsc">
              {(["karty", "mapa"] as const).map((option) => (
                <Link
                  key={option}
                  className={panelStyles.segmentLink}
                  href={albumHref(collection.slug, { stan, widok: option })}
                  aria-current={option === widok ? "page" : undefined}
                  aria-describedby={option === "mapa" ? "uwaga-mapa" : undefined}
                >
                  {option === "karty" ? "Karty" : "Mapa"}
                </Link>
              ))}
            </nav>
          )}
        </div>
        {collection.places.length === 0 ? (
          <p>Ta kolekcja nie ma jeszcze miejsc.</p>
        ) : (
          <>
            <p id="uwaga-mapa" className={panelStyles.mapNote}>
              Mapę dostarcza OpenStreetMap; po jej włączeniu serwer OpenStreetMap widzi adres IP
              urządzenia i oglądany obszar.
            </p>
            {widok === "mapa" ? (
              <div className={panelStyles.mapBlock}>
                <a className={panelStyles.skipLink} href="#lista-miejsc">
                  Pomiń mapę
                </a>
                {shown.length === 0 ? null : (
                  <CollectionMapLoader
                    bounds={collection.places.map((place) => ({
                      latitude: place.latitude,
                      longitude: place.longitude,
                    }))}
                    places={shown.map((place) => ({
                      id: place.id,
                      name: place.name,
                      address: place.address,
                      position: place.position,
                      latitude: place.latitude,
                      longitude: place.longitude,
                      state: kinds === null ? null : kinds.has(place.id) ? "visited" : "unvisited",
                    }))}
                  />
                )}
                <noscript>
                  {/* Without JavaScript the "loading" line would never go away: hide it. */}
                  <style>{`.${mapStyles.loading}{display:none}`}</style>
                  <p className={panelStyles.empty}>
                    Mapa wymaga JavaScriptu. Miejsca są na liście poniżej.
                  </p>
                </noscript>
              </div>
            ) : null}
            <div id="lista-miejsc" className={panelStyles.layout}>
              <div className={panelStyles.listColumn}>
                {counts === null ? null : (
                  <nav className={panelStyles.chips} aria-label="Filtr miejsc">
                    {STATE_FILTERS.map((filter) => (
                      <Link
                        key={filter}
                        className={panelStyles.chip}
                        href={albumHref(collection.slug, { stan: filter, widok })}
                        // Filtr zmienia tylko listę poniżej: strona zostaje tam, gdzie jest (U-07).
                        scroll={false}
                        aria-current={filter === stan ? "page" : undefined}
                      >
                        {STATE_FILTER_LABELS[filter]}
                        <span className={panelStyles.chipCount}>({counts[filter]})</span>
                      </Link>
                    ))}
                  </nav>
                )}
                {shown.length === 0 ? (
                  <p className={panelStyles.empty}>Żadne miejsce nie pasuje do tego filtra.</p>
                ) : kinds !== null ? (
                  <CollectionPlaces
                    places={shown.map((place) => ({
                      id: place.id,
                      name: place.name,
                      address: place.address,
                      position: place.position,
                      thumb: place.thumb,
                      kind: kinds.get(place.id) ?? null,
                    }))}
                  />
                ) : (
                  <ol className={panelStyles.grid}>
                    {shown.map((place) => (
                      <PlaceTile key={place.id} place={place} state={null} />
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
