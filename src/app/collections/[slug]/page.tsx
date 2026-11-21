import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { CollectionProgress } from "@/design-system/components/collection-progress";
import { getCollectionProgress } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import { progressCounts } from "@/features/album/domain/progress";
import {
  getPublishedCollection,
  getPublishedPlace,
} from "@/features/catalog/application/public-catalog";
import {
  STATE_FILTERS,
  STATE_FILTER_LABELS,
  albumHref,
  countByState,
  filterByState,
  formatUpdateDate,
  parseSelectedPlace,
  parseStateFilter,
  parseView,
  type VisitKind,
} from "@/features/catalog/domain/album-view";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { ogImageUrl } from "@/features/catalog/domain/collection-cover";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import type { Actor } from "@/features/identity/domain/actor";
import { listMyVisitKindsOfCollection } from "@/features/visits/application/mark-past-visits";
import { getVisitDeps } from "@/features/visits/infrastructure/visit-deps";
import { isWantedPlace } from "@/features/want-to-see/application/want-to-see";
import { getWantToSeeDeps } from "@/features/want-to-see/infrastructure/want-to-see-deps";

import albumStyles from "../../my/collections/collections.module.css";
import styles from "../../catalog.module.css";
import panelStyles from "./album.module.css";
import mapStyles from "./collection-map.module.css";
import { CollectionCover } from "./collection-cover";
import { CollectionMapLoader } from "./collection-map-loader";
import { CollectionPlaces } from "./collection-places";
import { PlaceCardLink } from "./place-card-link";
import { PlacePanel, type PanelPlace } from "./place-panel";
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

// The data of the panel (D-E12-6): the place from the public read (the guest context, so the
// panel shows exactly what the place page shows), the explorer's visit from the album read and
// the state of the "Chcę zobaczyć" list. A failure of the list leaves out only its button; a
// failure of the place read leaves a short note in the panel and the page whole.
async function loadPanel(
  placeId: string,
  actor: Actor | null,
  kinds: ReadonlyMap<string, VisitKind> | null,
): Promise<PanelPlace> {
  try {
    const [found, wanted] = await Promise.all([
      getPublishedPlace(placeId, getCatalogDeps()),
      // As on the place page: when the read of the visits failed, the button is left out too.
      actor === null || kinds === null ? Promise.resolve(null) : loadWanted(actor, placeId),
    ]);

    if (found.status !== "ok") {
      return { status: "none" };
    }

    return {
      status: "ok",
      place: found.value,
      visit: kinds === null ? undefined : (kinds.get(placeId) ?? null),
      wanted,
    };
  } catch (error) {
    logReadFailure("Collection panel read", error);

    return { status: "failed" };
  }
}

async function loadWanted(actor: Actor, placeId: string): Promise<boolean | null> {
  try {
    const answer = await isWantedPlace(actor, placeId, getWantToSeeDeps());

    return answer.status === "ok" ? answer.value.wanted : null;
  } catch (error) {
    logReadFailure("Collection panel want-to-see read", error);

    return null;
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

  if (image === null) {
    return { title };
  }

  return {
    title,
    openGraph: {
      title,
      type: "website",
      images: [{ url: image, alt: result.value.cover?.altText }],
    },
    twitter: { card: "summary_large_image", title, images: [image] },
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
  const asked = parseSelectedPlace(query.miejsce);
  // A place that is not in this collection gives no panel and no error.
  const selectedId =
    asked !== null && collection.places.some((place) => place.id === asked) ? asked : null;
  const panel: PanelPlace =
    selectedId === null
      ? { status: "none" }
      : await loadPanel(selectedId, album.kind === "explorer" ? album.actor : null, kinds);
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
      <header className={styles.header}>
        <p className={styles.itemMetaMono}>Kolekcja · {REGION_LABELS[collection.region]}</p>
        <h1 className={styles.collectionTitle}>{collection.title}</h1>
        {collection.cover === null ? null : <CollectionCover cover={collection.cover} />}
        {album.kind === "explorer" ? (
          <CollectionProgress
            {...progressCounts(album.progress)}
            label={`Twój postęp w kolekcji ${collection.title}`}
          />
        ) : null}
        {collection.summary === "" ? null : <p className={styles.summary}>{collection.summary}</p>}
        <p className={styles.meta}>Kurator: {collection.organization.name}</p>
        <p className={styles.meta}>
          {formatPlaceCount(collection.placeCount)} · aktualizacja{" "}
          {formatUpdateDate(collection.contentUpdatedAt)}
        </p>
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
          <SaveCollectionButton collectionId={collection.id} initialSaved={album.saved} />
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
        ) : (
          <>
            <nav className={panelStyles.filter} aria-label="Widok miejsc">
              {(["karty", "mapa"] as const).map((option) => (
                <Link
                  key={option}
                  className={panelStyles.filterLink}
                  href={albumHref(collection.slug, { stan, miejsce: selectedId, widok: option })}
                  aria-current={option === widok ? "page" : undefined}
                  aria-describedby={option === "mapa" ? "uwaga-mapa" : undefined}
                >
                  {option === "karty" ? "Karty" : "Mapa"}
                </Link>
              ))}
            </nav>
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
                  <nav className={panelStyles.filter} aria-label="Filtr miejsc">
                    {STATE_FILTERS.map((filter) => (
                      <Link
                        key={filter}
                        className={panelStyles.filterLink}
                        href={albumHref(collection.slug, {
                          stan: filter,
                          miejsce: selectedId,
                          widok,
                        })}
                        aria-current={filter === stan ? "page" : undefined}
                      >
                        {STATE_FILTER_LABELS[filter]}
                        <span className={panelStyles.filterCount}>({counts[filter]})</span>
                      </Link>
                    ))}
                  </nav>
                )}
                {shown.length === 0 ? (
                  <p className={panelStyles.empty}>Żadne miejsce nie pasuje do tego filtra.</p>
                ) : kinds !== null ? (
                  <CollectionPlaces
                    slug={collection.slug}
                    stan={stan}
                    widok={widok}
                    selectedId={selectedId}
                    places={shown.map((place) => ({
                      id: place.id,
                      name: place.name,
                      address: place.address,
                      position: place.position,
                      kind: kinds.get(place.id) ?? null,
                    }))}
                  />
                ) : (
                  <ol className={panelStyles.grid}>
                    {shown.map((place) => (
                      <li
                        key={place.id}
                        className={`${styles.item} ${place.id === selectedId ? panelStyles.selected : ""}`}
                      >
                        <PlaceCardLink
                          className={styles.itemLink}
                          href={`/places/${place.id}`}
                          selectHref={albumHref(collection.slug, { miejsce: place.id, widok })}
                          selected={place.id === selectedId}
                        >
                          <span className={styles.itemTitle}>
                            <span className={styles.itemNumber}>{place.position}.</span>{" "}
                            {place.name}
                          </span>
                          {place.address === "" ? null : (
                            <span className={styles.itemMeta}>{place.address}</span>
                          )}
                        </PlaceCardLink>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <PlacePanel panel={panel} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
