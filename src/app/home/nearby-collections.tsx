"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";

import { CollectionCard } from "@/design-system/components/collection-card";
import { StatusBadge } from "@/design-system/components/status-badge";
import { REGION_LABELS, type Region } from "@/features/catalog/domain/collection";
import {
  NEARBY_COARSE_ACCURACY_M,
  NEW_NEARBY_LABEL,
  formatNearbyDistance,
  isNewNearby,
  nearbyCollections,
  nearbyProblemMessage,
  nearbySummaryMessage,
  type NearbyCandidate,
  type NearbyProblem,
} from "@/features/catalog/domain/nearby";
import { formatPlaceCount } from "@/features/catalog/domain/place-count";

import styles from "./home-sections.module.css";

// The list comes from the server and is public. The distance is counted here: the position of
// the device is read only after a click, lives for the length of one callback and is never sent,
// stored, put in the address or logged (D-14, E12-Q4). What the state keeps are the nearest
// collections and their distances, not the position.
type Found = Readonly<{
  slug: string;
  title: string;
  region: string;
  placeCount: number;
  km: number;
  isNew: boolean;
}>;

type State =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "found"; hits: readonly Found[]; coarse: boolean }
  | { kind: "problem"; problem: NearbyProblem };

function problemOf(error: GeolocationPositionError): NearbyProblem {
  // 1 = PERMISSION_DENIED, 3 = TIMEOUT; anything else: no position available.
  return error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
}

// A little more than the 10 s timeout passed to the geolocation API.
const NEARBY_CLIENT_TIMEOUT_MS = 12_000;

const noSubscription = () => () => undefined;
const hasGeolocation = () => typeof navigator !== "undefined" && "geolocation" in navigator;

// "Kolekcje w okolicy" (E12-3). `candidates: null` is a failed read of the list: a message in
// the section, the rest of the page works.
export function NearbyCollections({
  candidates,
}: Readonly<{ candidates: readonly NearbyCandidate[] | null }>) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = useRef(false);
  // The server renders the button; a browser without geolocation drops it after hydration.
  const supported = useSyncExternalStore(noSubscription, hasGeolocation, () => true);

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
        const hits = nearbyCollections(candidates, coords).map(({ candidate, distanceKm }) => ({
          slug: candidate.slug,
          title: candidate.title,
          region: candidate.region,
          placeCount: candidate.placeCount,
          km: distanceKm,
          isNew: isNewNearby(candidate.firstPublishedAt, distanceKm, now),
        }));

        show({ kind: "found", hits, coarse: coords.accuracy > NEARBY_COARSE_ACCURACY_M });
      },
      (error) => show({ kind: "problem", problem: problemOf(error) }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  }

  const message =
    state.kind === "locating"
      ? "Ustalam Twoje położenie…"
      : state.kind === "found"
        ? nearbySummaryMessage(state.hits.length, state.coarse)
        : state.kind === "problem"
          ? nearbyProblemMessage(state.problem)
          : "";
  const emptyOrProblem =
    state.kind === "problem" || (state.kind === "found" && state.hits.length === 0);

  return (
    <section className={styles.section} aria-labelledby="okolica-title">
      <h2 id="okolica-title">W okolicy</h2>
      {candidates === null ? (
        <p role="alert" className={styles.failed}>
          Nie udało się wczytać kolekcji. Odśwież stronę.
        </p>
      ) : !supported ? (
        <div className={styles.empty}>
          <p>{nearbyProblemMessage("unsupported")}</p>
          <Link href="/search">Zobacz wszystkie kolekcje</Link>
        </div>
      ) : (
        <>
          <div className={styles.empty}>
            <p>Pokażemy kolekcje z Twojej okolicy. Pozycja zostaje w tej przeglądarce.</p>
            <button
              type="button"
              className="button button--outline"
              aria-disabled={state.kind === "locating"}
              onClick={locate}
            >
              {state.kind === "idle" ? "Pokaż kolekcje w okolicy" : "Sprawdź ponownie"}
            </button>
            <p role="status">{message}</p>
            {emptyOrProblem ? <Link href="/search">Zobacz wszystkie kolekcje</Link> : null}
          </div>
          {state.kind === "found" && state.hits.length > 0 ? (
            <ul className={styles.cards}>
              {state.hits.map((hit) => (
                <li key={hit.slug}>
                  <CollectionCard
                    href={`/collections/${hit.slug}`}
                    title={hit.title}
                    regionLabel={REGION_LABELS[hit.region as Region] ?? hit.region}
                  />
                  <p className={styles.cardNote}>
                    {formatNearbyDistance(hit.km)} · {formatPlaceCount(hit.placeCount)}
                  </p>
                  {hit.isNew ? (
                    <p className={styles.cardNote}>
                      <StatusBadge tone="info">{NEW_NEARBY_LABEL}</StatusBadge>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
