import type { Metadata } from "next";
import Link from "next/link";

import { logReadFailure } from "@/app/request-actor";
import { CollectionCard } from "@/design-system/components/collection-card";
import type {
  RecentCollection,
  SearchPlaceHit,
} from "@/features/catalog/application/catalog-types";
import {
  listAllPublishedCollections,
  searchPublicCatalog,
} from "@/features/catalog/application/public-search";
import { REGION_LABELS, regionsLabelOf, type Region } from "@/features/catalog/domain/collection";
import { cardCoverImage } from "@/features/catalog/domain/collection-cover";
import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";
import {
  SEARCH_MAX_LENGTH,
  REGION_LOCATIVE,
  SEARCH_RESULT_LIMIT,
  describeFound,
  formatCollectionCount,
} from "@/features/catalog/domain/search";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import catalog from "../catalog.module.css";
import home from "../home/home-sections.module.css";
import { ResultAnnouncer } from "./result-announcer";
import { SearchForm } from "./search-form";
import styles from "./search.module.css";

// Rendered on every request (proxy: `Cache-Control: private, no-store`). The results are
// public, always read in the guest context: a signed-in curator sees what a guest sees.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Szukaj — Krajozbiór" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// A failure of the database is logged by class only and handled by error.tsx next to this page
// (a server error with a Polish message), never shown as "no results".
async function load(phrase: string | undefined, region: string | undefined) {
  const deps = getCatalogDeps();

  try {
    const outcome = await searchPublicCatalog(phrase, region, deps);

    if (outcome.status === "none" || outcome.status === "invalid") {
      return { ...outcome, all: await listAllPublishedCollections(region, deps) };
    }

    return outcome;
  } catch (error) {
    logReadFailure("Public search", error);

    throw new Error("Public search failed");
  }
}

function CollectionResults({
  collections,
}: Readonly<{ collections: readonly RecentCollection[] }>) {
  return (
    <ul className={home.cards}>
      {collections.map((collection) => (
        <li key={collection.id}>
          <CollectionCard
            href={`/collections/${collection.slug}`}
            title={collection.title}
            regionLabel={regionsLabelOf(collection)}
            cover={cardCoverImage(collection.cover)}
          />
          <p className={home.cardNote}>
            {formatPlaceCount(collection.placeCount)} · {collection.organization.name}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PlaceResults({ places }: Readonly<{ places: readonly SearchPlaceHit[] }>) {
  return (
    <ul className={catalog.list}>
      {places.map((place) => (
        <li key={place.id} className={catalog.item}>
          <Link className={catalog.itemLink} href={`/places/${place.id}`}>
            <span className={catalog.itemTitle}>{place.name}</span>
            <span className={catalog.itemMeta}>{place.address}</span>
            <span className={catalog.itemMeta}>Kolekcja: {place.collection.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function AllCollections({
  collections,
  region,
}: Readonly<{ collections: readonly RecentCollection[]; region: Region | null }>) {
  return collections.length === 0 ? (
    <p>
      {region === null
        ? "Nie ma jeszcze opublikowanych kolekcji."
        : `W województwie ${REGION_LOCATIVE[region]} nie ma jeszcze opublikowanych kolekcji.`}
    </p>
  ) : (
    <CollectionResults collections={collections} />
  );
}

// `/search`: a phrase gives the matching collections and places; no phrase gives "Wszystkie
// kolekcje" with the region filter (E12-2, D-E12-4).
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const rawPhrase = first(params.q);
  const outcome = await load(rawPhrase, first(params.region));
  const formPhrase = (rawPhrase ?? "").slice(0, SEARCH_MAX_LENGTH * 2);

  if (outcome.status === "timeout" || outcome.status === "busy") {
    return (
      <div className={`content-width-wide ${styles.page}`}>
        <h1>Szukaj miejsc i kolekcji</h1>
        <SearchForm id="search" phrase={formPhrase} withRegion />
        <p role="alert" className={`${styles.notice} ${styles.noticeDanger}`}>
          {outcome.status === "busy"
            ? "Wyszukiwarka jest teraz zajęta. Spróbuj za chwilę."
            : "Wyszukiwanie trwa zbyt długo. Wpisz dokładniejszą nazwę."}
        </p>
      </div>
    );
  }

  if (outcome.status === "ok") {
    const { collections, places, region } = outcome;
    const found = describeFound(collections.length, places.length);
    const empty = collections.length === 0 && places.length === 0;

    return (
      <div className={`content-width-wide ${styles.page}`}>
        <h1>
          {empty
            ? `Nic nie znaleziono dla „${outcome.phrase}”`
            : `${found} dla „${outcome.phrase}”`}
        </h1>
        <ResultAnnouncer
          message={empty ? `Nic nie znaleziono dla „${outcome.phrase}”.` : `${found}.`}
        />
        <SearchForm id="search" phrase={outcome.phrase} region={region} withRegion />
        {outcome.moreCollections || outcome.morePlaces ? (
          <p role="status" className={styles.notice}>
            Pokazujemy pierwsze {SEARCH_RESULT_LIMIT}. Doprecyzuj wyszukiwanie.
          </p>
        ) : null}
        {empty ? (
          <div className={styles.empty}>
            <p>
              Sprawdź pisownię albo <Link href="/search">zobacz wszystkie kolekcje</Link>.
            </p>
          </div>
        ) : null}
        {collections.length === 0 ? null : (
          <section className={styles.section} aria-labelledby="wyniki-kolekcje">
            <h2 id="wyniki-kolekcje">Kolekcje</h2>
            <CollectionResults collections={collections} />
          </section>
        )}
        {places.length === 0 ? null : (
          <section className={styles.section} aria-labelledby="wyniki-miejsca">
            <h2 id="wyniki-miejsca">Miejsca</h2>
            <PlaceResults places={places} />
          </section>
        )}
      </div>
    );
  }

  const { all, region } = outcome;
  const count = formatCollectionCount(all.collections.length);
  const heading =
    region === null ? "Wszystkie kolekcje" : `Kolekcje: ${REGION_LABELS[region].toLowerCase()}`;
  const message =
    outcome.status === "invalid"
      ? outcome.reason === "too_short"
        ? "Wpisz co najmniej 2 znaki."
        : `Wpisz najwyżej ${SEARCH_MAX_LENGTH} znaków.`
      : null;

  return (
    <div className={`content-width-wide ${styles.page}`}>
      <h1>{heading}</h1>
      <ResultAnnouncer message={`${heading}: ${count}.`} />
      <SearchForm id="search" phrase={formPhrase} region={region} withRegion />
      {message === null ? null : (
        <p role="alert" className={`${styles.notice} ${styles.noticeDanger}`}>
          {message}
        </p>
      )}
      <section className={styles.section} aria-labelledby="wszystkie-kolekcje">
        <h2 id="wszystkie-kolekcje">{count}</h2>
        {all.truncated ? (
          <p role="status" className={styles.notice}>
            Pokazujemy pierwsze {MAX_COLLECTIONS_PER_LIST}. Wybierz województwo albo wpisz frazę.
          </p>
        ) : null}
        <AllCollections collections={all.collections} region={region} />
      </section>
    </div>
  );
}
