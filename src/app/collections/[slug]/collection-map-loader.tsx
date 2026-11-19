"use client";

import dynamic from "next/dynamic";

import styles from "./collection-map.module.css";
import type { MapPlace } from "./collection-map";

// `ssr: false` works only in a client component. The script of the map (Leaflet, ~42 KB
// compressed) is fetched when this view is rendered, i.e. after the explorer picks the map.
const CollectionMap = dynamic(() => import("./collection-map"), {
  ssr: false,
  loading: () => <p className={`${styles.notice} ${styles.loading}`}>Wczytuję mapę…</p>,
});

export function CollectionMapLoader({ places }: { places: readonly MapPlace[] }) {
  return <CollectionMap places={places} />;
}
