import type { PlaceCover } from "@/features/catalog/application/catalog-types";
import { THUMB_WIDTH } from "@/features/media/domain/limits";

import { PhotoCredit } from "./photo-credit";
import styles from "./place-photo.module.css";

// Stan miejsca dla odkrywcy: jeszcze nieodwiedzone (ramka przerywana, „Do odkrycia”) albo
// odwiedzone (ramka ciągła, „Odwiedzone”). Gość nie ma stanu: ramka ciągła i brak etykiety.
export type PlacePhotoState = "undiscovered" | "visited";

const STATE_LABELS: Readonly<Record<PlacePhotoState, string>> = {
  undiscovered: "Do odkrycia",
  visited: "Odwiedzone",
};

// Zdjęcie miejsca (E4-2b, D-E4-7; wygląd R3, D-57): w ramce „slotu” z numerem miejsca i stanem nad
// zdjęciem, z podpisem pod ramką. Zawsze w całości (`contain`, Q4): to jedyne pełne zdjęcie miejsca.
// Natywne <img> z `srcset`: miniatura `w400` dla wąskich ekranów, plik `main` dla szerokich.
// Wymiary z bazy rezerwują miejsce (strona nie skacze). Tekst alternatywny to nazwa miejsca:
// tytuł z Commons stoi w podpisie, więc czytnik ekranu nie czyta go drugi raz.
export function PlacePhoto({
  cover,
  placeName,
  number,
  state,
}: Readonly<{
  cover: PlaceCover;
  placeName: string;
  /** Numer miejsca w kolekcji (pokazany jako „01”); bez numeru i stanu nie ma wiersza nad zdjęciem. */
  number?: number;
  state?: PlacePhotoState;
}>) {
  const main = `/media/p/${cover.photoId}/main`;
  const thumb = `/media/p/${cover.photoId}/w400`;
  // Zdjęcie nie szersze niż miniatura nie ma wyboru: jeden plik.
  const hasChoice = cover.width > THUMB_WIDTH;
  const showRow = number !== undefined || state !== undefined;

  return (
    <figure className={styles.photo}>
      <div
        className={`${styles.slot} ${state === "undiscovered" ? styles.slotUndiscovered : ""}`}
        data-state={state ?? "guest"}
      >
        {showRow ? (
          <p className={styles.row}>
            <span>{number === undefined ? "" : String(number).padStart(2, "0")}</span>
            <span>{state === undefined ? "" : STATE_LABELS[state]}</span>
          </p>
        ) : null}
        <div className={styles.frame}>
          {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
          <img
            src={main}
            srcSet={hasChoice ? `${thumb} ${THUMB_WIDTH}w, ${main} ${cover.width}w` : undefined}
            sizes={hasChoice ? "(min-width: 64rem) 52rem, 100vw" : undefined}
            width={cover.width}
            height={cover.height}
            alt={placeName}
            decoding="async"
            fetchPriority="high"
          />
        </div>
      </div>
      <PhotoCredit photo={cover} />
    </figure>
  );
}
