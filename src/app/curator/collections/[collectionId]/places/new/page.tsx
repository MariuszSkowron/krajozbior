import type { Metadata } from "next";
import Link from "next/link";

import { getCuratorCollection } from "@/features/catalog/application/curator-queries";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import styles from "../../../../curator.module.css";
import { pageValue, requireCurator } from "../../../../curator-session";
import { PlaceForm } from "../../../../place-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Nowe miejsce — Krajozbiór" };

// A new place of the organization that owns the collection; it goes to the end
// of the list. The owner is taken from the stored collection, never from here.
export default async function NewPlacePage({
  params,
}: Readonly<{ params: Promise<{ collectionId: string }> }>) {
  const { collectionId } = await params;
  const path = `/curator/collections/${collectionId}/places/new`;
  const { actor } = await requireCurator(path);
  const { collection } = pageValue(
    await getCuratorCollection(actor, collectionId, getCatalogDeps()),
    path,
  );

  return (
    <>
      <nav className={styles.breadcrumb} aria-label="Ścieżka">
        <ol>
          <li>
            <Link href="/curator">Kolekcje</Link>
          </li>
          <li>
            <Link href={`/curator/collections/${collection.id}`}>{collection.title}</Link>
          </li>
          <li aria-current="page">Nowe miejsce</li>
        </ol>
      </nav>
      <header className={styles.pageHead}>
        <div>
          <p className="eyebrow">{collection.title}</p>
          <h1>Nowe miejsce</h1>
        </div>
      </header>
      <PlaceForm mode="create" collectionId={collection.id} />
    </>
  );
}
