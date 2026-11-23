import Link from "next/link";

import { getRequestActor, logActorFailure, logReadFailure } from "@/app/request-actor";
import { getHomeAlbum } from "@/features/album/application/home-album";
import { listMySavedCollectionSlugs } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import {
  listNearbyCandidates,
  listRecentlyPublishedCollections,
} from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import type { Actor } from "@/features/identity/domain/actor";
import { CONTACT_EMAIL } from "@/features/legal/domain/legal-pages";
import { getMyProfile } from "@/features/profile/application/profile";
import { getProfileDeps } from "@/features/profile/infrastructure/profile-deps";

import { AlbumSummary } from "./home/album-summary";
import { CollectionsToDiscover } from "./home/collections-to-discover";
import { FavoriteCollections } from "./home/favorite-collections";
import { RecentVisits } from "./home/recent-visits";
import styles from "./home.module.css";
import { SearchForm } from "./search/search-form";

export const dynamic = "force-dynamic";

// Kolekcje do odkrycia na stronie głównej. Przycisk „Pokaż najbliższe” sortuje właśnie tę listę,
// więc jest dłuższa niż dawna lista „W okolicy” (sześć), ale mieści się w trzech–czterech rzędach.
const DISCOVER_LIMIT = 12;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The public part: a guest read, the same for everyone (a curator included). A failure
// leaves the section with a message and the rest of the page whole.
async function loadDiscover(extra: number) {
  try {
    // Saved collections are left out later, so as many more are read: the list keeps twelve.
    return await listRecentlyPublishedCollections(DISCOVER_LIMIT + extra, getCatalogDeps());
  } catch (error) {
    logReadFailure("Home collections read", error);

    return null;
  }
}

// The list behind "Pokaż najbliższe": public, the same for everyone. The distance is counted in
// the browser, so the position of the device never comes here (E12-3).
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

// Slugs of the collections the explorer saved: "Kolekcje do odkrycia" leaves them out, because
// they are already in "Moje kolekcje". A failed read leaves the list whole (an empty set).
async function loadSavedSlugs(actor: Actor): Promise<ReadonlySet<string>> {
  try {
    const result = await listMySavedCollectionSlugs(actor, getAlbumDeps());

    return new Set(result.status === "ok" ? result.value : []);
  } catch (error) {
    logReadFailure("Home saved collections read", error);

    return new Set();
  }
}

// The first name for the greeting (the same profile read as the profile screen). Without a
// name, or when the read fails, the greeting is said without it; the failure is logged by class.
async function loadFirstName(actor: Actor): Promise<string | null> {
  try {
    const result = await getMyProfile(actor, getProfileDeps());

    return result.status === "ok" ? result.value.firstName : null;
  } catch (error) {
    logReadFailure("Home profile read", error);

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
  const savedRead = actor === null ? Promise.resolve(null) : loadSavedSlugs(actor);
  const [allDiscover, allNearby, album, firstName, saved] = await Promise.all([
    // The saved ones are known first, so the list can read that many more than it shows.
    savedRead.then((slugs) => loadDiscover(slugs?.size ?? 0)),
    loadNearby(),
    actor === null ? Promise.resolve(null) : loadAlbum(actor),
    actor === null ? Promise.resolve(null) : loadFirstName(actor),
    savedRead,
  ]);
  // A saved collection is not "to discover": it has its place in "Moje kolekcje". The list is
  // trimmed to twelve only after the filter, so it does not shrink with every save.
  const discover =
    allDiscover === null || saved === null
      ? allDiscover
      : allDiscover.filter(({ slug }) => !saved.has(slug)).slice(0, DISCOVER_LIMIT);
  const nearby =
    allNearby === null || saved === null
      ? allNearby
      : allNearby.filter(({ slug }) => !saved.has(slug));
  const allSaved =
    discover !== null && allDiscover !== null && allDiscover.length > 0 && discover.length === 0;

  return (
    <div className={`content-width-wide ${styles.page}`}>
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
        <div className={styles.heroIntro}>
          {actor === null ? (
            <>
              <h1 id="start-title">Odkrywaj miejsca i zbieraj je w swoim albumie</h1>
              <p className={styles.lead}>
                Krajozbiór to kolekcje ciekawych miejsc w Polsce. Przeglądaj je bez konta; po
                zalogowaniu zapiszesz kolekcję i zaznaczysz miejsca już odwiedzone.
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
            <h1 id="start-title">
              {firstName === null ? "Dzień dobry" : `Dzień dobry, ${firstName}`}
            </h1>
          )}
        </div>
        <SearchForm id="home-search" />
      </section>
      {album === null ? null : (
        <>
          <AlbumSummary summary={album.summary} />
          <FavoriteCollections collections={album.favorites} />
        </>
      )}
      {album === null ? null : <RecentVisits visits={album.recentVisits} />}
      <CollectionsToDiscover collections={discover} candidates={nearby} allSaved={allSaved} />
    </div>
  );
}
