import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { logReadFailure } from "@/app/request-actor";
import { getPublicNews } from "@/features/news/application/public-news";
import { showUpdatedNote } from "@/features/news/domain/news";
import { formatNewsDate, newsBodyParagraphs, newsDateTime } from "@/features/news/domain/news-view";
import { getNewsReadDeps } from "@/features/news/infrastructure/news-read-deps";

import { NewsBody, NewsEventDays, NewsKicker, NewsOrganization } from "../news-parts";
import styles from "../news.module.css";

// Same rules as the list: dynamic, always read as a guest.
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

// A failure of the database is logged by class only; the page then shows error.tsx of the
// segment (S5), the metadata falls back to the defaults.
const load = cache(async (slug: string) => {
  try {
    return await getPublicNews(slug, getNewsReadDeps());
  } catch (error) {
    logReadFailure("Public news read", error);

    return { status: "failed" } as const;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await load((await params).slug);

  if (result.status !== "ok") {
    return {};
  }

  const { title, lead, publishedAt } = result.value;

  // No `canonical` and no `og:url`: the application does not know its public address yet
  // (no `metadataBase`), and a wrong address would be worse than none.
  return {
    title: `${title} — Krajozbiór`,
    description: lead,
    openGraph: {
      type: "article",
      title,
      description: lead,
      locale: "pl_PL",
      siteName: "Krajozbiór",
      publishedTime: publishedAt.toISOString(),
    },
  };
}

// `/news/[slug]`: one published item. A draft, a withdrawn, an unknown or a malformed
// address is the same 404 (the item may come back under the same address).
export default async function NewsItemPage({ params }: { params: Params }) {
  const result = await load((await params).slug);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "failed") {
    // Handled by error.tsx of the segment: a server error with a Polish message.
    throw new Error("Public news read failed");
  }

  const item = result.value;
  const updated = showUpdatedNote(item.publishedAt, item.contentUpdatedAt);

  return (
    <article className={`content-width ${styles.article}`}>
      <Link className={styles.back} href="/news">
        ← Wszystkie aktualności
      </Link>
      <NewsKicker card={item} />
      <h1>{item.title}</h1>
      <p className={styles.articleLead}>{item.lead}</p>
      <NewsEventDays card={item} />
      <div className={styles.meta}>
        <NewsOrganization name={item.organization.name} verification={item.verification} />
        {updated && item.contentUpdatedAt !== null ? (
          <p>
            Zaktualizowano{" "}
            <time dateTime={newsDateTime(item.contentUpdatedAt)}>
              {formatNewsDate(item.contentUpdatedAt)}
            </time>
          </p>
        ) : null}
      </div>
      <NewsBody paragraphs={newsBodyParagraphs(item.body)} />
      {item.collection === null && item.place === null ? null : (
        <section className={styles.related} aria-labelledby="powiazane">
          <h2 id="powiazane">Powiązane</h2>
          {item.collection === null ? null : (
            <p>
              Kolekcja:{" "}
              <Link href={`/collections/${item.collection.slug}`}>{item.collection.title}</Link>
            </p>
          )}
          {item.place === null ? null : (
            <p>
              Miejsce: <Link href={`/places/${item.place.id}`}>{item.place.name}</Link>
            </p>
          )}
        </section>
      )}
    </article>
  );
}
