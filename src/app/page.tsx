import Link from "next/link";

import { getRequestActor, logActorFailure, logReadFailure } from "@/app/request-actor";
import { getHomeAlbum } from "@/features/album/application/home-album";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import {
  listNearbyCandidates,
  listRecentlyPublishedCollections,
} from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import type { Actor } from "@/features/identity/domain/actor";
import { CONTACT_EMAIL } from "@/features/legal/domain/legal-pages";

import { AlbumSummary } from "./home/album-summary";
import { CollectionsToDiscover } from "./home/collections-to-discover";
import { FavoriteCollections } from "./home/favorite-collections";
import { NearbyCollections } from "./home/nearby-collections";
import { RecentVisits } from "./home/recent-visits";
import styles from "./home.module.css";
import { SearchForm } from "./search/search-form";

export const dynamic = "force-dynamic";

// Kolekcje do odkrycia na stronie głównej.
const DISCOVER_LIMIT = 6;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The public part: a guest read, the same for everyone (a curator included). A failure
// leaves the section with a message and the rest of the page whole.
async function loadDiscover() {
  try {
    return await listRecentlyPublishedCollections(DISCOVER_LIMIT, getCatalogDeps());
  } catch (error) {
    logReadFailure("Home collections read", error);

    return null;
  }
}

// The list for "W okolicy": public, the same for everyone. The distance is counted in the
// browser, so the position of the device never comes here (E12-3).
async function loadNearby() {
  try {
    return await listNearbyCandidates(getCatalogDeps());
  } catch (error) {
    logReadFailure("Home nearby read", error);

    return null;
  }
}

// The personal part: only for a signed-in explorer. A failure leaves the page without
// the personal sections and is logged by class only.
async function loadAlbum(actor: Actor) {
  try {
    const result = await getHomeAlbum(actor, getAlbumDeps());

    return result.status === "ok" ? result.value : null;
  } catch (error) {
    logReadFailure("Home album read", error);

    return null;
  }
}

// The home page (E12-1). A guest sees the introduction and the collections to discover; a
// signed-in explorer sees their album first. It reads the session only to choose the
// version; a failed lookup shows the guest version.
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const actor = await getRequestActor().catch((error: unknown) => {
    logActorFailure(error);
    return null;
  });
  const signedOut = first(params.wylogowano) === "1";
  // The person declined the terms on the "Zanim zaczniesz" screen (F-K3, E11-Q4 A).
  const termsDeclined = first(params.wylogowano) === "odmowa";
  const signOutFailed = first(params.wylogowanie) === "blad";
  // Only a signal for the message after deleting the account (E9-5).
  const accountDeleted = first(params.konto) === "usuniete";
  const [discover, nearby, album] = await Promise.all([
    loadDiscover(),
    loadNearby(),
    actor === null ? Promise.resolve(null) : loadAlbum(actor),
  ]);

  return (
    <div className={`content-width ${styles.page}`}>
      {accountDeleted ? (
        <p role="status" className={styles.status}>
          Twoje konto zostało usunięte.
        </p>
      ) : null}
      {signedOut ? (
        <p role="status" className={styles.status}>
          Wylogowano.
        </p>
      ) : null}
      {termsDeclined ? (
        <p role="status" className={styles.status}>
          Wylogowano. Bez akceptacji regulaminu nie korzystasz z konta. Zapisaliśmy tylko Twój adres
          e-mail; jeśli chcesz, żebyśmy go usunęli, napisz na{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      ) : null}
      {signOutFailed ? (
        <p role="status" className={styles.status}>
          Nie udało się wylogować. Spróbuj ponownie.
        </p>
      ) : null}
      <section className={styles.hero} aria-labelledby="start-title">
        {actor === null ? (
          <>
            <h1 id="start-title">Odkrywaj miejsca i zbieraj je w swoim albumie</h1>
            <p className={styles.lead}>
              Krajozbiór to kolekcje ciekawych miejsc w Polsce. Przeglądaj je bez konta; po
              zalogowaniu zapiszesz kolekcję i zaznaczysz miejsca, w których już byłeś.
            </p>
            <div className={styles.actions}>
              <Link className="button button--primary" href="/login">
                Zaloguj się
              </Link>
              <Link className="button button--outline" href="#do-odkrycia">
                Zobacz kolekcje
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 id="start-title">Dzień dobry</h1>
            <p className={styles.lead}>Oto Twój album i kolekcje, które warto odkryć.</p>
            <div className={styles.actions}>
              <Link className="button button--outline" href="/my">
                Profil
              </Link>
            </div>
          </>
        )}
        <SearchForm id="home-search" />
      </section>
      {album === null ? null : (
        <>
          <AlbumSummary summary={album.summary} />
          <FavoriteCollections collections={album.favorites} />
        </>
      )}
      <NearbyCollections candidates={nearby} />
      {album === null ? null : <RecentVisits visits={album.recentVisits} />}
      <CollectionsToDiscover collections={discover} />
    </div>
  );
}
