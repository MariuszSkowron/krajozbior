import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { StatusBadge } from "@/design-system/components/status-badge";
import { searchPublicCatalog } from "@/features/catalog/application/public-search";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { SEARCH_MAX_LENGTH } from "@/features/catalog/domain/search";
import { getOwnCollection } from "@/features/own-collections/application/own-collections";
import { unavailablePlaceLabel, removedPlaceLabel } from "@/features/own-collections/domain/entry";
import { OWN_REGION_LABELS } from "@/features/own-collections/domain/own-collection";
import { getOwnCollectionsDeps } from "@/features/own-collections/infrastructure/own-collections-deps";

import catalog from "../../../../catalog.module.css";
import curatorStyles from "../../../../curator/curator.module.css";
import {
  AddPlaceButton,
  DeleteCollectionButton,
  EntriesRegion,
  RemoveEntryButton,
} from "../own-collection-actions";
import { OwnCollectionForm } from "../own-collection-form";
import styles from "../own.module.css";

// Private page: rendered on every request, never cached by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moja kolekcja — Krajozbiór" };

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The search of places of the public catalog (always the guest context: the hits are what every
// guest sees, so a draft of a curator never appears). A failure only drops the results.
async function searchPlaces(phrase: string | undefined) {
  if (phrase === undefined || phrase.trim() === "") {
    return null;
  }

  try {
    return await searchPublicCatalog(phrase, undefined, getCatalogDeps());
  } catch (error) {
    logReadFailure("Own collection place search", error);

    return { status: "failed" as const };
  }
}

export default async function OwnCollectionPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref(`/my/collections/own/${id}`));
  }

  let result;

  try {
    result = await getOwnCollection(actor, id, getOwnCollectionsDeps());
  } catch (error) {
    logReadFailure("Own collection read", error);
    // Handled by error.tsx of "Moje kolekcje": a server error with a Polish message.
    throw new Error("Own collection read failed");
  }

  if (result.status === "unauthenticated") {
    redirect(loginHref(`/my/collections/own/${id}`));
  }

  // Another person's collection, a malformed id and a missing one all look the same.
  if (result.status !== "ok") {
    notFound();
  }

  const { collection, entries, progress } = result.value;
  const phrase = first(query.q);
  const found = await searchPlaces(phrase);
  const present = new Set(
    entries.flatMap((entry) => (entry.placeId === null ? [] : [entry.placeId])),
  );
  const hits =
    found !== null && found.status === "ok"
      ? [...new Map(found.places.map((place) => [place.id, place])).values()]
      : [];

  return (
    <div className={`content-width-wide ${catalog.page}`}>
      <header className={catalog.header}>
        <p>
          <Link href="/my/collections">← Moje kolekcje</Link>
        </p>
        <div className={styles.titleRow}>
          <h1>{collection.title}</h1>
          <StatusBadge tone="neutral">Prywatna</StatusBadge>
        </div>
        <p className={catalog.meta}>
          {OWN_REGION_LABELS[collection.region]}
          {progress.total === 0 ? "" : ` · Postęp ${progress.visited}/${progress.total}`}
        </p>
        {collection.summary === "" ? null : <p className={catalog.summary}>{collection.summary}</p>}
      </header>

      <section className={catalog.section} aria-labelledby="miejsca">
        <h2 id="miejsca" tabIndex={-1}>
          Miejsca ({entries.length})
        </h2>
        <EntriesRegion>
          {entries.length === 0 ? (
            <p className={styles.muted}>
              Ta kolekcja nie ma jeszcze miejsc. Wyszukaj miejsce poniżej i dodaj je.
            </p>
          ) : (
            <ol className={styles.entries}>
              {entries.map((entry) => (
                <li key={entry.id} className={styles.entry}>
                  {entry.state === "available" && entry.place !== null ? (
                    <>
                      <p className={styles.entryTitle}>
                        <Link href={`/places/${entry.placeId}`}>{entry.place.name}</Link>
                        {entry.visited ? (
                          <StatusBadge tone="success">Odwiedzone</StatusBadge>
                        ) : null}
                      </p>
                      {entry.place.address === "" ? null : (
                        <p className={styles.muted}>{entry.place.address}</p>
                      )}
                      <RemoveEntryButton
                        collectionId={collection.id}
                        entryId={entry.id}
                        label={entry.place.name}
                      />
                    </>
                  ) : (
                    <>
                      <p className={styles.entryTitle}>
                        <StatusBadge tone="warning">
                          {entry.state === "removed"
                            ? removedPlaceLabel(entry.nameSnapshot)
                            : unavailablePlaceLabel(entry.nameSnapshot)}
                        </StatusBadge>
                      </p>
                      <RemoveEntryButton
                        collectionId={collection.id}
                        entryId={entry.id}
                        label={entry.nameSnapshot}
                      />
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
        </EntriesRegion>
      </section>

      <section className={catalog.section} aria-labelledby="dodaj">
        <h2 id="dodaj">Dodaj miejsce z katalogu</h2>
        <form
          className={styles.search}
          method="get"
          action={`/my/collections/own/${collection.id}`}
        >
          <div className={styles.searchField}>
            <label htmlFor="q">Nazwa albo adres miejsca</label>
            <input
              id="q"
              name="q"
              type="search"
              maxLength={SEARCH_MAX_LENGTH}
              defaultValue={phrase ?? ""}
              autoComplete="off"
            />
          </div>
          <button type="submit" className="button button--outline">
            Szukaj
          </button>
        </form>
        <div role="status" aria-live="polite">
          {found === null ? null : found.status === "ok" ? (
            <p className={styles.muted}>
              {hits.length === 0
                ? "Nic nie znaleziono. Spróbuj innej nazwy."
                : `Znalezione miejsca: ${hits.length}.`}
            </p>
          ) : found.status === "invalid" ? (
            <p className={styles.muted}>Wpisz co najmniej dwa znaki.</p>
          ) : found.status === "none" ? null : (
            <p className={styles.muted}>Wyszukiwanie chwilowo nie działa. Spróbuj za chwilę.</p>
          )}
        </div>
        {hits.length === 0 ? null : (
          <ul className={styles.entries}>
            {hits.map((hit) => (
              <li key={hit.id} className={styles.entry}>
                <p className={styles.entryTitle}>
                  <Link href={`/places/${hit.id}`}>{hit.name}</Link>
                </p>
                <p className={styles.muted}>
                  {hit.address === ""
                    ? hit.collection.title
                    : `${hit.address} · ${hit.collection.title}`}
                </p>
                <AddPlaceButton
                  collectionId={collection.id}
                  placeId={hit.id}
                  placeName={hit.name}
                  alreadyThere={present.has(hit.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={catalog.section} aria-labelledby="ustawienia">
        <h2 id="ustawienia">Nazwa i opis</h2>
        <OwnCollectionForm
          mode="edit"
          collection={{
            id: collection.id,
            version: collection.version,
            title: collection.title,
            summary: collection.summary,
            region: collection.region,
          }}
        />
      </section>

      <section className={catalog.section} aria-labelledby="usun">
        <h2 id="usun">Usuwanie</h2>
        <p className={curatorStyles.muted}>
          Usunięcie kolekcji nie usuwa Twoich wizyt: zostają w albumie.
        </p>
        <DeleteCollectionButton collectionId={collection.id} />
      </section>
    </div>
  );
}
