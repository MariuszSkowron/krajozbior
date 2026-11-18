import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { CollectionCard } from "@/design-system/components/collection-card";
import { listMyCollectionsWithProgress } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import { progressCounts } from "@/features/album/domain/progress";
import { REGION_LABELS } from "@/features/catalog/domain/collection";

import catalog from "../../catalog.module.css";
import styles from "./collections.module.css";

// Private page: rendered on every request, never cached by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moje kolekcje — Krajozbiór" };

export default async function MyCollectionsPage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/collections"));
  }

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
          <h2 id="zapisane">{`Zapisane kolekcje (${collections.length})`}</h2>
          <ul className={styles.grid}>
            {collections.map((collection) => (
              <li key={collection.id}>
                <CollectionCard
                  href={`/collections/${collection.slug}`}
                  title={collection.title}
                  regionLabel={REGION_LABELS[collection.region]}
                  progress={progressCounts(collection.progress)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
