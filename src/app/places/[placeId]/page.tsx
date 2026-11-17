import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { logReadFailure } from "@/app/request-actor";
import { getPublishedPlace } from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import styles from "../../catalog.module.css";

// Same rules as the collection page: dynamic, never in a shared cache (the
// visit button and "Chcę zobaczyć" of a signed-in explorer come later).
export const dynamic = "force-dynamic";

type Params = Promise<{ placeId: string }>;

const load = cache(async (placeId: string) => {
  try {
    return await getPublishedPlace(placeId, getCatalogDeps());
  } catch (error) {
    logReadFailure("Public place read", error);

    return { status: "failed" } as const;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await load((await params).placeId);

  return result.status === "ok" ? { title: `${result.value.name} — Krajozbiór` } : {};
}

export default async function PlacePage({ params }: { params: Params }) {
  const result = await load((await params).placeId);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "failed") {
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("Public place read failed");
  }

  const place = result.value;

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1>{place.name}</h1>
        <p className={styles.meta}>Prowadzi: {place.organization.name}</p>
      </header>
      <dl className={styles.facts}>
        {place.address === "" ? null : (
          <div>
            <dt>Adres</dt>
            <dd>{place.address}</dd>
          </div>
        )}
        {place.accessInfo === "" ? null : (
          <div>
            <dt>Dostęp</dt>
            <dd>{place.accessInfo}</dd>
          </div>
        )}
        {place.description === "" ? null : (
          <div>
            <dt>Opis</dt>
            <dd>{place.description}</dd>
          </div>
        )}
      </dl>
      <section className={styles.section} aria-labelledby="kolekcje">
        <h2 id="kolekcje">Kolekcje z tym miejscem</h2>
        <ul className={styles.list}>
          {place.collections.map((collection) => (
            <li key={collection.slug} className={styles.item}>
              <Link className={styles.itemLink} href={`/collections/${collection.slug}`}>
                <span className={styles.itemTitle}>{collection.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
