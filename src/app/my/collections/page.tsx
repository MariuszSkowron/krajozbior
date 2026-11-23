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
  noMatchingCollectionsMessage,
  parseProgressFilter,
  type ProgressFilter,
} from "@/features/album/domain/progress-filter";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { CollectionCard } from "@/design-system/components/collection-card";
import { StatusBadge } from "@/design-system/components/status-badge";
import { listOwnCollections } from "@/features/own-collections/application/own-collections";
import { OWN_REGION_LABELS } from "@/features/own-collections/domain/own-collection";
import { getOwnCollectionsDeps } from "@/features/own-collections/infrastructure/own-collections-deps";

import catalog from "../../catalog.module.css";
import styles from "./collections.module.css";
import ownStyles from "./own/own.module.css";

// Private page: rendered on every request, never cached by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moje kolekcje — Krajozbiór" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The address of a state filter: "Wszystkie" is the plain page, the rest carry `?stan=`.
const filterHref = (filter: ProgressFilter) =>
  filter === "wszystkie" ? "/my/collections" : `/my/collections?stan=${filter}`;

export default async function MyCollectionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/collections"));
  }

  const params = await searchParams;
  const filter = parseProgressFilter(params.stan);
  let result;
  let ownResult;

  try {
    // Two independent reads, one after the other would only make the page slower.
    [result, ownResult] = await Promise.all([
      listMyCollectionsWithProgress(actor, getAlbumDeps()),
      listOwnCollections(actor, getOwnCollectionsDeps()),
    ]);
  } catch (error) {
    logReadFailure("My collections read", error);
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("My collections read failed");
  }

  if (result.status !== "ok" || ownResult.status !== "ok") {
    redirect(loginHref("/my/collections"));
  }

  const own = ownResult.value;
  const collections = result.value;
  const shown = collections.filter((collection) =>
    matchesProgressFilter(collection.progress, filter),
  );
  const counts = Object.fromEntries(
    PROGRESS_FILTERS.map((value) => [
      value,
      collections.filter((collection) => matchesProgressFilter(collection.progress, value)).length,
    ]),
  ) as Record<ProgressFilter, number>;

  return (
    <div className={`content-width-wide ${catalog.page}`}>
      <header className={catalog.header}>
        <h1>Moje kolekcje</h1>
        <p className={catalog.summary}>Zapisane kolekcje i Twój postęp w nich.</p>
      </header>
      <section className={catalog.section} aria-labelledby="moje">
        <div className={ownStyles.sectionHead}>
          <h2 id="moje">Moje własne kolekcje ({own.length})</h2>
          <Link className="button button--primary" href="/my/collections/own/new">
            Nowa kolekcja
          </Link>
        </div>
        {own.length === 0 ? (
          <p className={ownStyles.muted}>
            Nie masz jeszcze własnych kolekcji. Własna kolekcja jest prywatna: widzisz ją tylko Ty.
          </p>
        ) : (
          <ul className={styles.grid}>
            {own.map((collection) => (
              <li key={collection.id}>
                <CollectionCard
                  href={`/my/collections/own/${collection.id}`}
                  title={collection.title}
                  regionLabel={OWN_REGION_LABELS[collection.region]}
                  progress={{ visited: collection.visited, total: collection.total }}
                />
                <p className={styles.cardNote}>
                  <StatusBadge tone="neutral">Prywatna</StatusBadge>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {collections.length === 0 ? (
        <section className={styles.empty} aria-labelledby="pusto">
          <h2 id="pusto">Nie masz jeszcze zapisanych kolekcji</h2>
          <p>Kolekcje zapiszesz przyciskiem na stronie kolekcji.</p>
          <Link className="button button--primary" href="/">
            Zobacz kolekcje
          </Link>
        </section>
      ) : (
        <section className={catalog.section} aria-labelledby="zapisane">
          <h2 id="zapisane">
            {filter === "wszystkie"
              ? `Zapisane kolekcje (${collections.length})`
              : `Zapisane kolekcje (${shown.length} z ${collections.length})`}
          </h2>
          {/* Links with the state in the address: one click, no script needed, no jump to the top. */}
          <nav className={styles.filter} aria-label="Stan postępu">
            {PROGRESS_FILTERS.map((value) => (
              <Link
                key={value}
                className={styles.filterLink}
                href={filterHref(value)}
                scroll={false}
                aria-current={value === filter ? "page" : undefined}
              >
                {PROGRESS_FILTER_LABELS[value]}{" "}
                <span className={styles.filterCount}>({counts[value]})</span>
              </Link>
            ))}
          </nav>
          {shown.length === 0 ? (
            <p className={styles.noMatch}>
              {noMatchingCollectionsMessage(filter)}{" "}
              <Link href="/my/collections">Pokaż wszystkie</Link>
            </p>
          ) : (
            <ul className={styles.grid}>
              {shown.map((collection) => (
                <li key={collection.slug}>
                  <CollectionCard
                    href={`/collections/${collection.slug}`}
                    title={collection.title}
                    regionLabel={REGION_LABELS[collection.region]}
                    progress={progressCounts(collection.progress)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
