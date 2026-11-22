import type { Metadata } from "next";
import Link from "next/link";

import { logReadFailure } from "@/app/request-actor";
import { listPublicNews } from "@/features/news/application/public-news";
import { parseNewsFilter, type NewsFilter } from "@/features/news/domain/news-view";
import { getNewsReadDeps } from "@/features/news/infrastructure/news-read-deps";

import { NewsCard } from "./news-parts";
import styles from "./news.module.css";

// Rendered on every request (proxy: `Cache-Control: private, no-store`). The list is public,
// always read in the guest context: a signed-in account sees what a guest sees.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Aktualności — Krajozbiór",
  description: "Wiadomości od zespołu Krajozbioru.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// A failure of the database is logged by class only and handled by error.tsx next to this page
// (a server error with a Polish message), never shown as "no news" (S5).
async function load(filter: NewsFilter) {
  try {
    return await listPublicNews(filter, getNewsReadDeps());
  } catch (error) {
    logReadFailure("Public news list", error);

    throw new Error("Public news list failed");
  }
}

function countText(count: number, filter: NewsFilter): string {
  if (filter === "events") {
    return count === 1 ? "1 wydarzenie" : `Wydarzenia: ${count}`;
  }

  return count === 1 ? "1 aktualność" : `Aktualności: ${count}`;
}

// `/news`: the newest published items; `?filtr=wydarzenia` keeps the events that are on or
// still to come (E7-R3, spec E7 14.5).
export default async function NewsPage({ searchParams }: { searchParams: SearchParams }) {
  const filter = parseNewsFilter((await searchParams).filtr);
  const cards = await load(filter);

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1>Aktualności</h1>
        <p className={styles.subtitle}>Wiadomości od zespołu Krajozbioru</p>
      </header>
      <nav aria-label="Filtr aktualności">
        <ul className={styles.filters}>
          <li>
            <Link
              className={styles.filter}
              href="/news"
              aria-current={filter === null ? "true" : undefined}
            >
              Wszystkie
            </Link>
          </li>
          <li>
            <Link
              className={styles.filter}
              href="/news?filtr=wydarzenia"
              aria-current={filter === "events" ? "true" : undefined}
            >
              Wydarzenia
            </Link>
          </li>
        </ul>
      </nav>
      <p className={styles.count}>{countText(cards.length, filter)}</p>
      {cards.length === 0 ? (
        <div className={styles.empty}>
          <p>
            {filter === "events"
              ? "Nie ma teraz zapowiedzi wydarzeń."
              : "Zespół Krajozbioru nie opublikował jeszcze aktualności."}
          </p>
          {filter === "events" ? (
            <Link className="button button--outline" href="/news">
              Pokaż wszystkie aktualności
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className={styles.list}>
          {cards.map((card, index) => (
            <li key={card.slug}>
              <NewsCard card={card} featured={index === 0 && filter === null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
