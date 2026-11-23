import Link from "next/link";
import type { ReactNode } from "react";

import type { PlaceThumb as PlaceThumbData } from "@/features/catalog/application/catalog-types";

import styles from "./album.module.css";
import { PlaceThumb } from "./place-thumb";

export type TilePlace = {
  id: string;
  name: string;
  address: string;
  position: number;
  thumb: PlaceThumbData | null;
};

// Stan miejsca dla odkrywcy: odwiedzone na miejscu, z przeszłości albo jeszcze nie. Gość nie ma
// stanu (`null`): kafelek bez znacznika i bez przyciemnienia.
export type TileState = "on_site" | "past" | "todo" | null;

const STATE_WORDS = {
  on_site: "Odwiedzone",
  past: "Z przeszłości",
  todo: "Do odkrycia",
} as const;

// Numer miejsca z zerem wiodącym („01”), jak w makiecie.
const pad = (position: number) => String(position).padStart(2, "0");

// Kafelek miejsca w kolekcji (R3): zdjęcie 4:3 z numerem i stanem pod spodem, nazwą serifem i
// adresem. Odwiedzone mają znacznik (ptaszek, tylko ozdoba: stan niesie tekst) i cienką ramkę,
// nieodwiedzone są przyciemnione. Telefon: wiersz z miniaturą. Cały kafelek jest jednym linkiem;
// w trybie wyboru wizyt z przeszłości (`pick`) jest etykietą pola wyboru.
export function PlaceTile({
  place,
  state,
  pick,
}: Readonly<{ place: TilePlace; state: TileState; pick?: ReactNode }>) {
  const visited = state === "on_site" || state === "past";
  const body = (
    <>
      <span className={styles.photo}>
        <PlaceThumb thumb={place.thumb} />
        {visited ? (
          <span className={styles.badge} aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          </span>
        ) : null}
      </span>
      <span className={styles.tileText}>
        <span className={styles.stateRow}>
          {pad(place.position)}
          {state === null ? null : (
            <>
              {" · "}
              <span className={visited ? styles.stateVisited : undefined}>
                {STATE_WORDS[state]}
              </span>
            </>
          )}
        </span>
        <span className={styles.tileName}>{place.name}</span>
        {place.address === "" ? null : <span className={styles.tileAddress}>{place.address}</span>}
      </span>
    </>
  );

  return (
    <li
      className={`${styles.tile} ${visited ? styles.visited : ""} ${state === "todo" ? styles.todo : ""}`}
    >
      {pick === undefined ? (
        <Link className={styles.tileLink} href={`/places/${place.id}`}>
          {body}
        </Link>
      ) : (
        <label className={styles.tileLink}>
          {pick}
          {body}
        </label>
      )}
    </li>
  );
}
