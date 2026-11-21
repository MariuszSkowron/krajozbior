import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { listMyCollectionsWithProgress } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import { progressCounts } from "@/features/album/domain/progress";
import {
  PROGRESS_FILTERS,
  PROGRESS_FILTER_LABELS,
  matchesProgressFilter,
  parseProgressFilter,
} from "@/features/album/domain/progress-filter";
import { listNearbyCandidates } from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { REGION_LABELS } from "@/features/catalog/domain/collection";

import catalog from "../../catalog.module.css";
import styles from "./collections.module.css";
import { SavedCollectionsList, type SavedCollectionItem } from "./saved-collections-list";

// Private page: rendered on every request, never cached by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moje kolekcje — Krajozbiór" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The public list of "W okolicy" (a guest read, the same for everyone): it holds the centre and
// the first publication of a collection, which "Nowa w okolicy" needs. A failed read only drops
// the mark; the page itself stays whole.
async function loadNearbyCandidates() {
  try {
    return await listNearbyCandidates(getCatalogDeps());
  } catch (error) {
    logReadFailure("My collections nearby read", error);

    return null;
  }
}

export default async function MyCollectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/collections"));
  }

  const params = await searchParams;
  const filter = parseProgressFilter(params.stan);
  let result;

  try {
    result = await listMyCollectionsWithProgress(actor, getAlbumDeps());
  } catch (error) {
    logReadFailure("My collections read", error);
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("My collections read failed");
  }

  if (result.status !== "ok") {
    redirect(loginHref("/my/collections"));
  }

  const collections = result.value;
  const candidates = collections.length === 0 ? null : await loadNearbyCandidates();
  const candidateOf = new Map((candidates ?? []).map((candidate) => [candidate.slug, candidate]));
  const shown = collections.filter((collection) =>
    matchesProgressFilter(collection.progress, filter),
  );
  const items: SavedCollectionItem[] = shown.map((collection) => {
    const candidate = candidateOf.get(collection.slug);

    return {
      slug: collection.slug,
      title: collection.title,
      regionLabel: REGION_LABELS[collection.region],
      ...progressCounts(collection.progress),
      centerLat: candidate?.centerLat ?? null,
      centerLon: candidate?.centerLon ?? null,
      firstPublishedAt: candidate?.firstPublishedAt ?? null,
    };
  });

  return (
    <div className={`content-width ${catalog.page}`}>
      <header className={catalog.header}>
        <h1>Moje kolekcje</h1>
        <p className={catalog.summary}>Kolekcje, które zapisałeś, razem z Twoim postępem.</p>
      </header>
      {collections.length === 0 ? (
        <section className={styles.empty} aria-labelledby="pusto">
          <h2 id="pusto">Nie masz jeszcze zapisanych kolekcji</h2>
          <p>Otwórz kolekcję i wybierz „Zapisz kolekcję”, a pojawi się tutaj.</p>
          <Link className="button button--primary" href="/">
            Przejdź do katalogu
          </Link>
        </section>
      ) : (
        <section className={catalog.section} aria-labelledby="zapisane">
          <h2 id="zapisane">
            {filter === "wszystkie"
              ? `Zapisane kolekcje (${collections.length})`
              : `Zapisane kolekcje (${shown.length} z ${collections.length})`}
          </h2>
          <form className={styles.filter} method="get" action="/my/collections">
            <div className={styles.field}>
              <label htmlFor="stan">Stan postępu</label>
              <select id="stan" name="stan" defaultValue={filter}>
                {PROGRESS_FILTERS.map((value) => (
                  <option key={value} value={value}>
                    {PROGRESS_FILTER_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="button button--outline">
              Pokaż
            </button>
          </form>
          {items.length === 0 ? (
            <p className={styles.noMatch}>
              Żadna zapisana kolekcja nie ma stanu „{PROGRESS_FILTER_LABELS[filter]}”.{" "}
              <Link href="/my/collections">Pokaż wszystkie</Link>
            </p>
          ) : (
            <SavedCollectionsList items={items} offerNearby={candidates !== null} />
          )}
        </section>
      )}
    </div>
  );
}
