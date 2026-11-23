"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";

import { CollectionCard } from "@/design-system/components/collection-card";
import { StatusBadge } from "@/design-system/components/status-badge";
import type { RecentCollection } from "@/features/catalog/application/catalog-types";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { cardCoverImage } from "@/features/catalog/domain/collection-cover";
import {
  NEARBY_COARSE_ACCURACY_M,
  NEW_NEARBY_LABEL,
  formatNearbyDistance,
  isNewNearby,
  nearbyCollections,
  nearbyProblemMessage,
  nearbySortedMessage,
  type NearbyCandidate,
  type NearbyProblem,
} from "@/features/catalog/domain/nearby";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";

import styles from "./home-sections.module.css";

// One section "Kolekcje do odkrycia" (D-49 pkt 2, K-34): the recently published collections,
// visible to everyone. The button "Pokaż najbliższe" sorts the same list by distance. The list
// of candidates comes from the server and is public. The distance is counted here: the position
// of the device is read only after a click, lives for the length of one callback and is never
// sent, stored, put in the address or logged (D-14, E12-Q4). What the state keeps are the
// distances of the collections, not the position.
type Found = Readonly<{ km: number; isNew: boolean }>;

type State =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "found"; bySlug: ReadonlyMap<string, Found>; coarse: boolean }
  | { kind: "problem"; problem: NearbyProblem };

function problemOf(error: GeolocationPositionError): NearbyProblem {
  // 1 = PERMISSION_DENIED, 3 = TIMEOUT; anything else: no position available.
  return error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
}

// A little more than the 10 s timeout passed to the geolocation API.
const NEARBY_CLIENT_TIMEOUT_MS = 12_000;

// "pending": the server and the first render in the browser (hydration), so the button is not
// shown before the component is ready in the browser. "unsupported": no geolocation at all.
type Support = "pending" | "supported" | "unsupported";

const noSubscription = () => () => undefined;
const browserSupport = (): Support =>
  typeof navigator !== "undefined" && "geolocation" in navigator ? "supported" : "unsupported";
const serverSupport = (): Support => "pending";

// The collections themselves are sorted by distance; one without a known distance (no place with
// a position) goes last, in its original order.
function sortedByDistance(
  collections: readonly RecentCollection[],
  bySlug: ReadonlyMap<string, Found>,
): readonly RecentCollection[] {
  return collections
    .map((collection, index) => ({ collection, index, km: bySlug.get(collection.slug)?.km }))
    .sort((a, b) => {
      if (a.km === undefined || b.km === undefined) {
        return a.km === b.km ? a.index - b.index : a.km === undefined ? 1 : -1;
      }

      return a.km - b.km || a.index - b.index;
    })
    .map(({ collection }) => collection);
}

// `collections: null` is a failed read of the list: a message in the section, the rest of the
// page works. `candidates: null` is a failed read of the positions: the list stays, the button
// is left out.
export function CollectionsToDiscover({
  collections,
  candidates,
  allSaved = false,
}: Readonly<{
  collections: readonly RecentCollection[] | null;
  candidates: readonly NearbyCandidate[] | null;
  /** The explorer saved every collection of the list, so nothing is left to discover. */
  allSaved?: boolean;
}>) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = useRef(false);
  // The button is rendered only in the browser, after hydration, and only with geolocation.
  const support = useSyncExternalStore(noSubscription, browserSupport, serverSupport);

  const attempt = useRef(0);

  function locate() {
    // aria-disabled keeps the focus on the button, so a click while locating is ignored here.
    if (busy.current || candidates === null) {
      return;
    }

    busy.current = true;

    const mine = ++attempt.current;
    // The first result of this attempt wins; a late one (after our own time limit) is ignored.
    const show = (next: State) => {
      if (attempt.current !== mine) {
        return;
      }

      attempt.current += 1;
      clearTimeout(timer);
      busy.current = false;
      setState(next);
    };
    // The timeout of the API starts only after the permission is given; when the prompt is
    // closed without an answer no callback ever comes, so the section has its own limit.
    const timer = setTimeout(
      () => show({ kind: "problem", problem: "timeout" }),
      NEARBY_CLIENT_TIMEOUT_MS,
    );

    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const now = new Date();
        // No radius and no limit: the whole list is sorted, not narrowed.
        const bySlug = new Map<string, Found>(
          nearbyCollections(candidates, coords, Infinity, Infinity).map(
            ({ candidate, distanceKm }) => [
              candidate.slug,
              { km: distanceKm, isNew: isNewNearby(candidate.firstPublishedAt, distanceKm, now) },
            ],
          ),
        );

        show({ kind: "found", bySlug, coarse: coords.accuracy > NEARBY_COARSE_ACCURACY_M });
      },
      (error) => show({ kind: "problem", problem: problemOf(error) }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  }

  const found = state.kind === "found" ? state : null;
  const shown =
    collections === null || found === null
      ? collections
      : sortedByDistance(collections, found.bySlug);
  const message =
    state.kind === "locating"
      ? "Ustalamy Twoje położenie…"
      : found !== null
        ? nearbySortedMessage(
            (collections ?? []).filter((collection) => found.bySlug.has(collection.slug)).length,
            found.coarse,
          )
        : state.kind === "problem"
          ? nearbyProblemMessage(state.problem)
          : "";
  const canSort = collections !== null && collections.length > 0 && candidates !== null;

  return (
    <section className={styles.section} id="do-odkrycia" aria-labelledby="odkrycie-title">
      <div className={styles.sectionHead}>
        <h2 id="odkrycie-title">Kolekcje do odkrycia</h2>
        <Link className={styles.sectionLink} href="/search">
          Wszystkie kolekcje
        </Link>
      </div>
      {collections === null ? (
        <p role="alert" className={styles.failed}>
          Nie udało się wczytać kolekcji. Odśwież stronę.
        </p>
      ) : collections.length === 0 ? (
        <p>
          {allSaved
            ? "Masz zapisane wszystkie kolekcje."
            : "Nie ma jeszcze opublikowanych kolekcji."}
        </p>
      ) : (
        <>
          {canSort ? (
            <div className={styles.sortBar}>
              {support === "supported" ? (
                <>
                  <button
                    type="button"
                    className="button button--outline"
                    aria-disabled={state.kind === "locating"}
                    onClick={locate}
                  >
                    {state.kind === "idle" ? "Pokaż najbliższe" : "Sprawdź ponownie"}
                  </button>
                  <p className={styles.sortHint}>Położenie zostaje w tej przeglądarce.</p>
                </>
              ) : null}
              <p role="status" className={styles.sortStatus}>
                {support === "unsupported" ? nearbyProblemMessage("unsupported") : message}
              </p>
            </div>
          ) : null}
          <ul className={styles.cards}>
            {(shown ?? []).map((collection) => {
              const distance = found?.bySlug.get(collection.slug);

              return (
                <li key={collection.id}>
                  <CollectionCard
                    href={`/collections/${collection.slug}`}
                    title={collection.title}
                    regionLabel={REGION_LABELS[collection.region]}
                    cover={cardCoverImage(collection.cover)}
                  />
                  <p className={styles.cardNote}>
                    {distance === undefined ? null : `${formatNearbyDistance(distance.km)} · `}
                    {formatPlaceCount(collection.placeCount)} · {collection.organization.name}
                  </p>
                  {distance?.isNew ? (
                    <p className={styles.cardNote}>
                      <StatusBadge tone="info">{NEW_NEARBY_LABEL}</StatusBadge>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
