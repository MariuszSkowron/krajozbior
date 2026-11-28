import Link from "next/link";
import { connection } from "next/server";

import { getRequestActor, logActorFailure, logReadFailure } from "@/app/request-actor";
import { getHomeAlbum } from "@/features/album/application/home-album";
import { listMySavedCollectionSlugs } from "@/features/album/application/saved-collections";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import {
  getCollectionBanner,
  getHomeBanner,
  listRecentlyPublishedCollections,
} from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import type { Actor } from "@/features/identity/domain/actor";
import {
  EXISTING_ACCOUNT_NOTICE,
  FIRST_SIGN_IN_EXISTING_ACCOUNT,
  FIRST_SIGN_IN_PARAM,
  LOGIN_PATH,
  SIGNUP_PATH,
} from "@/features/identity/domain/login-entry";
import { isNewExplorerAccount } from "@/features/identity/domain/role-home";
import { CONTACT_ADDRESSES } from "@/features/legal/domain/legal-pages";
import { getMyProfile } from "@/features/profile/application/profile";
import { getProfileDeps } from "@/features/profile/infrastructure/profile-deps";

import { AlbumSummary } from "./home/album-summary";
import { CollectionsToDiscover } from "./home/collections-to-discover";
import { FavoriteCollections, MoreFavoriteCollections } from "./home/favorite-collections";
import { HomeBanner } from "./home/home-banner";
import bannerStyles from "./home/home-banner.module.css";
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

// The cover of a collection with its credit for the banner (public read). No slug, no photo or a
// failed read gives `null`: the banner keeps the calm placeholder and the page stays whole.
async function loadBanner(slug: string | null) {
  if (slug === null) {
    return null;
  }

  try {
    return await getCollectionBanner(slug, getCatalogDeps());
  } catch (error) {
    logReadFailure("Home banner read", error);

    return null;
  }
}

// The banner photo drawn from the pool, a new draw on every request (`connection()` keeps the
// page out of prerendering, so the draw is not frozen at build time). A failed read gives `null`.
async function loadDrawnBanner() {
  await connection();

  try {
    return await getHomeBanner(getCatalogDeps());
  } catch (error) {
    logReadFailure("Home banner pool read", error);

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
  // "Załóż konto" with an address that already had an account (said only after the code).
  const existingAccount =
    actor !== null && first(params[FIRST_SIGN_IN_PARAM]) === FIRST_SIGN_IN_EXISTING_ACCOUNT;
  const savedRead = actor === null ? Promise.resolve(null) : loadSavedSlugs(actor);
  const [allDiscover, album, firstName, saved, guestDrawn] = await Promise.all([
    // The saved ones are known first, so the list can read that many more than it shows.
    savedRead.then((slugs) => loadDiscover(slugs?.size ?? 0)),
    actor === null ? Promise.resolve(null) : loadAlbum(actor),
    actor === null ? Promise.resolve(null) : loadFirstName(actor),
    savedRead,
    // A guest always gets the draw, so its read starts with the others, not after them.
    actor === null ? loadDrawnBanner() : Promise.resolve(null),
  ]);
  // A saved collection is not "to discover": it has its place in "Moje kolekcje". The list is
  // trimmed to twelve only after the filter, so it does not shrink with every save.
  const discover =
    allDiscover === null || saved === null
      ? allDiscover
      : allDiscover.filter(({ slug }) => !saved.has(slug)).slice(0, DISCOVER_LIMIT);
  const allSaved =
    discover !== null && allDiscover !== null && allDiscover.length > 0 && discover.length === 0;

  // The banner photo. Explorer with a saved collection: its cover. Otherwise (a guest, an explorer
  // without a saved collection) a fixed photo: the cover of the first of "Kolekcje do odkrycia"
  // that has one (the draw from a pool comes later and falls back to this).
  const favorites = album?.favorites ?? [];
  const bannerSlug =
    favorites.length > 0
      ? favorites[0].slug
      : (discover?.find(({ cover }) => cover !== null)?.slug ?? null);
  // A guest and an explorer without a saved collection first get a drawn photo from the pool
  // (R3, PR 4); with no photo in the pool (or a failed read) the fixed photo stays as the fallback.
  const drawn =
    actor === null
      ? guestDrawn
      : favorites.length === 0 && album !== null
        ? await loadDrawnBanner()
        : null;
  const banner = drawn ?? (await loadBanner(actor !== null && album === null ? null : bannerSlug));
  // No visit and no saved collection yet: the start page is the big banner with the first step
  // (the album block of zeros and "Moje kolekcje" stay hidden until the first visit or save).
  const newExplorer = album !== null && isNewExplorerAccount(album.summary);

  return (
    <div className={`content-width-wide ${styles.page}`}>
      {accountDeleted ? (
        <p role="status" className={styles.status}>
          Twoje konto zostało usunięte.
        </p>
      ) : null}
      {existingAccount ? (
        <p role="status" className={styles.status}>
          {EXISTING_ACCOUNT_NOTICE}
        </p>
      ) : null}
      {signedOut ? (
        <p role="status" className={styles.status}>
          Wylogowano.
        </p>
      ) : null}
      {termsDeclined ? (
        <p role="status" className={styles.status}>
          Wylogowano. Konto działa dopiero po akceptacji regulaminu. Zapisaliśmy tylko Twój adres
          e-mail; jeśli chcesz, żebyśmy go usunęli, napisz na{" "}
          <a href={`mailto:${CONTACT_ADDRESSES.privacy}`}>{CONTACT_ADDRESSES.privacy}</a>.
        </p>
      ) : null}
      {signOutFailed ? (
        <p role="status" className={styles.status}>
          Nie udało się wylogować. Spróbuj ponownie.
        </p>
      ) : null}
      {actor === null ? (
        <>
          <section aria-labelledby="start-title">
            <HomeBanner cover={banner}>
              <h1 id="start-title">
                Odkrywaj miejsca i zbieraj je <em>w swoim albumie</em>
              </h1>
              <p className={bannerStyles.lead}>
                Gotowe kolekcje miejsc w Polsce. Na miejscu potwierdzasz wizytę telefonem i widzisz
                swój postęp, np. 5/13. Kolekcje przeglądasz bez konta.
              </p>
              <div className={bannerStyles.actions}>
                <Link className="button button--primary" href={SIGNUP_PATH}>
                  Załóż konto
                </Link>
                <Link
                  className={`button button--outline ${bannerStyles.onPhoto}`}
                  href="#do-odkrycia"
                >
                  Zobacz kolekcje
                </Link>
              </div>
              <p className={bannerStyles.haveAccount}>
                Masz już konto?{" "}
                <Link className={bannerStyles.haveAccountLink} href={LOGIN_PATH}>
                  Zaloguj się
                </Link>
              </p>
            </HomeBanner>
          </section>
          <div className={styles.guestSearch}>
            <SearchForm id="home-search" outlineButton />
          </div>
        </>
      ) : newExplorer ? (
        <>
          <section aria-labelledby="start-title">
            <HomeBanner cover={banner}>
              <p className={bannerStyles.greeting}>
                {firstName === null ? "Dzień dobry" : `Dzień dobry, ${firstName}`}
              </p>
              <h1 id="start-title" className={bannerStyles.narrowTitle}>
                Wybierz pierwszą kolekcję
              </h1>
              <p className={bannerStyles.lead}>
                Zapisz kolekcję, a pokażemy tu Twój postęp: ile miejsc odwiedzono i ile zostało.
              </p>
              <div className={bannerStyles.actions}>
                <Link className="button button--primary" href="#do-odkrycia">
                  Zobacz kolekcje
                </Link>
              </div>
            </HomeBanner>
          </section>
          <div className={styles.guestSearch}>
            <SearchForm id="home-search" outlineButton />
          </div>
        </>
      ) : (
        <section className={styles.hero} aria-labelledby="start-title">
          <h1 id="start-title">
            {firstName === null ? (
              "Dzień dobry"
            ) : (
              <>
                Dzień dobry, <em>{firstName}</em>
              </>
            )}
          </h1>
          <SearchForm id="home-search" outlineButton />
        </section>
      )}
      {album === null || newExplorer ? null : (
        <>
          <FavoriteCollections
            collections={album.favorites}
            banner={favorites.length > 0 ? banner : null}
            fallbackBanner={favorites.length > 0 ? null : banner}
            hasVisits={album.summary.discoveredPlaces > 0}
          />
          <AlbumSummary summary={album.summary} />
          <MoreFavoriteCollections collections={album.favorites} />
        </>
      )}
      {album === null ? null : <RecentVisits visits={album.recentVisits} />}
      <CollectionsToDiscover collections={discover} allSaved={allSaved} />
    </div>
  );
}
