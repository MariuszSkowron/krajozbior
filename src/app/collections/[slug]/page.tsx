import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { logReadFailure } from "@/app/request-actor";
import { getPublishedCollection } from "@/features/catalog/application/public-catalog";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import styles from "../../catalog.module.css";

// Rendered on every request and never cached by a shared cache (src/proxy.ts
// sets `Cache-Control: private, no-store`): later this page also shows the
// signed-in explorer's progress, which must not reach anyone else.
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

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

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await load((await params).slug);

  return result.status === "ok" ? { title: `${result.value.title} — Krajozbiór` } : {};
}

export default async function CollectionPage({ params }: { params: Params }) {
  const result = await load((await params).slug);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "failed") {
    return (
      <div className={`content-width ${styles.page}`}>
        <h1>Kolekcja</h1>
        <p role="alert" className={styles.status}>
          Nie udało się wczytać kolekcji. Spróbuj ponownie za chwilę.
        </p>
      </div>
    );
  }

  const collection = result.value;

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1>{collection.title}</h1>
        <p className={styles.meta}>
          {REGION_LABELS[collection.region]} · Prowadzi: {collection.organization.name}
        </p>
        {collection.summary === "" ? null : <p className={styles.summary}>{collection.summary}</p>}
      </header>
      <section className={styles.section} aria-labelledby="miejsca">
        <h2 id="miejsca">Miejsca w kolekcji ({collection.places.length})</h2>
        <ol className={styles.list}>
          {collection.places.map((place) => (
            <li key={place.id} className={styles.item}>
              <Link className={styles.itemLink} href={`/places/${place.id}`}>
                <span className={styles.itemTitle}>
                  {place.position}. {place.name}
                </span>
                {place.address === "" ? null : (
                  <span className={styles.itemMeta}>{place.address}</span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
