"use client";

import { useRef, useState, useSyncExternalStore } from "react";

import { CollectionCard } from "@/design-system/components/collection-card";
import { StatusBadge } from "@/design-system/components/status-badge";
import {
  NEARBY_COARSE_ACCURACY_M,
  NEW_NEARBY_LABEL,
  haversineKm,
  isNewNearby,
  nearbyProblemMessage,
  type NearbyProblem,
} from "@/features/catalog/domain/nearby";

import styles from "./collections.module.css";

// One saved collection with what the card needs. `centerLat`, `centerLon` and `firstPublishedAt`
// come from the public list of "W okolicy" (null for a collection without places, e.g. a
// nationwide one, which never gets the mark, D-34).
export type SavedCollectionItem = Readonly<{
  slug: string;
  title: string;
  regionLabel: string;
  visited: number;
  total: number;
  centerLat: number | null;
  centerLon: number | null;
  firstPublishedAt: string | null;
}>;

type State =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "done"; newSlugs: ReadonlySet<string>; coarse: boolean }
  | { kind: "problem"; problem: NearbyProblem };

const CLIENT_TIMEOUT_MS = 12_000;

const noSubscription = () => () => undefined;
const hasGeolocation = () => typeof navigator !== "undefined" && "geolocation" in navigator;

// "Moje kolekcje" with the mark "Nowa w okolicy" (E12-S4, E12-Q6). As in "W okolicy", the
// position of the device is read only after a click, lives for one callback and is never sent,
// stored or put in the address; the state keeps only which collections are new nearby.
export function SavedCollectionsList({
  items,
  offerNearby,
}: Readonly<{ items: readonly SavedCollectionItem[]; offerNearby: boolean }>) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const busy = useRef(false);
  const attempt = useRef(0);
  const supported = useSyncExternalStore(noSubscription, hasGeolocation, () => true);

  function locate() {
    if (busy.current) {
      return;
    }

    busy.current = true;

    const mine = ++attempt.current;
    const show = (next: State) => {
      if (attempt.current !== mine) {
        return;
      }

      attempt.current += 1;
      clearTimeout(timer);
      busy.current = false;
      setState(next);
    };
    const timer = setTimeout(
      () => show({ kind: "problem", problem: "timeout" }),
      CLIENT_TIMEOUT_MS,
    );

    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const now = new Date();
        const newSlugs = new Set<string>();

        for (const item of items) {
          if (item.centerLat === null || item.centerLon === null) {
            continue;
          }

          const distanceKm = haversineKm(
            coords.latitude,
            coords.longitude,
            item.centerLat,
            item.centerLon,
          );

          if (isNewNearby(item.firstPublishedAt, distanceKm, now)) {
            newSlugs.add(item.slug);
          }
        }

        show({ kind: "done", newSlugs, coarse: coords.accuracy > NEARBY_COARSE_ACCURACY_M });
      },
      (error) =>
        show({
          kind: "problem",
          problem: error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable",
        }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  }

  const message =
    state.kind === "locating"
      ? "Ustalam Twoje położenie…"
      : state.kind === "done"
        ? newMessage(state.newSlugs.size, state.coarse)
        : state.kind === "problem"
          ? nearbyProblemMessage(state.problem)
          : "";

  return (
    <>
      {offerNearby && supported ? (
        <div className={styles.nearby}>
          <p>
            Sprawdzimy, które z Twoich kolekcji są nowe w Twojej okolicy. Pozycja zostaje w tej
            przeglądarce.
          </p>
          <button
            type="button"
            className="button button--outline"
            aria-disabled={state.kind === "locating"}
            onClick={locate}
          >
            {state.kind === "idle" ? "Pokaż nowe w okolicy" : "Sprawdź ponownie"}
          </button>
          <p role="status">{message}</p>
        </div>
      ) : null}
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item.slug}>
            <CollectionCard
              href={`/collections/${item.slug}`}
              title={item.title}
              regionLabel={item.regionLabel}
              progress={{ visited: item.visited, total: item.total }}
            />
            {state.kind === "done" && state.newSlugs.has(item.slug) ? (
              <p className={styles.cardNote}>
                <StatusBadge tone="info">{NEW_NEARBY_LABEL}</StatusBadge>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

function newMessage(count: number, coarse: boolean): string {
  const found =
    count === 0
      ? "Żadna z Twoich kolekcji nie jest nowa w okolicy."
      : count === 1
        ? "Jedna z Twoich kolekcji jest nowa w okolicy."
        : `Nowe w okolicy kolekcje: ${count}.`;

  return coarse ? `${found} Lokalizacja jest niedokładna, więc wynik jest przybliżony.` : found;
}
