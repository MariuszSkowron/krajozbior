"use client";

import dynamic from "next/dynamic";

import styles from "./place-map.module.css";

// `ssr: false` works only in a client component. The script of the map (Leaflet) and the tiles
// are fetched only after the curator picks "Pokaż mapę" (the form works without them).
export const PlaceMapLoader = dynamic(() => import("./place-map"), {
  ssr: false,
  loading: () => <p className={styles.instruction}>Wczytuję mapę…</p>,
});
