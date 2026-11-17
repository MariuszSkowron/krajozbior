import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { getPublishedPlace } from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { hasVisitedPlace } from "@/features/visits/application/confirm-on-site-visit";
import { getVisitDeps } from "@/features/visits/infrastructure/visit-deps";
import { isWantedPlace } from "@/features/want-to-see/application/want-to-see";
import { getWantToSeeDeps } from "@/features/want-to-see/infrastructure/want-to-see-deps";

import albumStyles from "../../my/collections/collections.module.css";
import styles from "../../catalog.module.css";
import { VisitConfirmation } from "./visit-confirmation";

// Same rules as the collection page: dynamic, never in a shared cache (the
// visit state of a signed-in explorer must not reach anyone else).
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

// What the page adds for the visitor: a guest is sent to sign in and back here,
// an explorer gets the visit button (or the note that the place is visited). A
// failure leaves the public page whole, without the personal part.
async function loadVisit(placeId: string) {
  try {
    const actor = await getRequestActor();

    if (actor === null) {
      return { kind: "guest", loginHref: loginHref(`/places/${placeId}`) } as const;
    }

    const state = await hasVisitedPlace(actor, placeId, getVisitDeps());
    const wanted = await isWantedPlace(actor, placeId, getWantToSeeDeps());

    return state.status === "ok" && wanted.status === "ok"
      ? ({
          kind: "explorer",
          visited: state.value.visited,
          wanted: wanted.value.wanted,
        } as const)
      : ({ kind: "none" } as const);
  } catch (error) {
    logReadFailure("Place visit read", error);

    return { kind: "unavailable" } as const;
  }
}

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
  const visit = await loadVisit((await params).placeId);

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
      <section className={styles.section} aria-labelledby="wizyta">
        <h2 id="wizyta">Wizyta</h2>
        {visit.kind === "guest" ? (
          <div>
            <Link className={albumStyles.action} href={visit.loginHref}>
              Zaloguj się, aby potwierdzić wizytę
            </Link>
            <p className={albumStyles.feedback}>Po zalogowaniu wrócisz na tę stronę.</p>
            <Link
              className={`${albumStyles.action} ${albumStyles.secondary}`}
              href={visit.loginHref}
            >
              Zaloguj się, aby zapisać na Chcę zobaczyć
            </Link>
          </div>
        ) : visit.kind === "explorer" ? (
          visit.visited ? (
            <p>Masz już zapisaną wizytę w tym miejscu.</p>
          ) : (
            <VisitConfirmation placeId={place.id} initialWanted={visit.wanted} />
          )
        ) : visit.kind === "unavailable" ? (
          <p className={albumStyles.feedback}>
            Nie udało się sprawdzić Twojej wizyty. Odśwież stronę za chwilę.
          </p>
        ) : null}
      </section>
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
