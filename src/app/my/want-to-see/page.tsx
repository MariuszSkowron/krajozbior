import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { listWantToSee } from "@/features/want-to-see/application/want-to-see";
import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";
import { getWantToSeeDeps } from "@/features/want-to-see/infrastructure/want-to-see-deps";

import catalog from "../../catalog.module.css";
import styles from "../collections/collections.module.css";

// Private page: rendered on every request, never cached by a shared cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Chcę zobaczyć — Krajozbiór" };

export default async function WantToSeePage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/want-to-see"));
  }

  let result;

  try {
    result = await listWantToSee(actor, getWantToSeeDeps());
  } catch (error) {
    logReadFailure("Want-to-see read", error);
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("Want-to-see read failed");
  }

  if (result.status !== "ok") {
    redirect(loginHref("/my/want-to-see"));
  }

  const places = result.value;

  return (
    <div className={`content-width ${catalog.page}`}>
      <header className={catalog.header}>
        <h1>Chcę zobaczyć</h1>
        <p className={catalog.summary}>Miejsca, które zapisałeś na później, od najnowszych.</p>
      </header>
      {places.length === 0 ? (
        <section className={styles.empty} aria-labelledby="pusto">
          <h2 id="pusto">Nie masz jeszcze zapisanych miejsc</h2>
          <p>Otwórz miejsce i wybierz „Chcę zobaczyć”, a pojawi się tutaj.</p>
          <Link className={styles.action} href="/">
            Przejdź do katalogu
          </Link>
        </section>
      ) : (
        <section className={catalog.section} aria-labelledby="zapisane">
          <h2 id="zapisane">{`Zapisane miejsca (${places.length})`}</h2>
          <ul className={catalog.list}>
            {places.map((place) => (
              <li key={place.id} className={catalog.item}>
                <Link className={catalog.itemLink} href={`/places/${place.id}`}>
                  <span className={catalog.itemTitle}>{place.name}</span>
                  {place.address === "" ? null : (
                    <span className={catalog.itemMeta}>{place.address}</span>
                  )}
                  <span className={catalog.itemMeta}>
                    Zapisano: {formatSavedDate(place.savedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
