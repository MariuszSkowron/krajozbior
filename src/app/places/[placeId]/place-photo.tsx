import type { PlaceCover } from "@/features/catalog/application/catalog-types";
import { THUMB_WIDTH } from "@/features/media/domain/limits";

import { PhotoCredit } from "./photo-credit";
import styles from "./place-photo.module.css";

// Okładka miejsca (E4-2b, D-E4-7): pierwsze zdjęcie z podpisem. Natywne <img> z `srcset`:
// miniatura `w400` dla wąskich ekranów, plik `main` dla szerokich. Wymiary z bazy rezerwują
// miejsce (strona nie skacze). Tekst alternatywny to nazwa miejsca (5.11.7): tytuł z Commons stoi
// w podpisie, więc czytnik ekranu nie czyta go drugi raz.
export function PlacePhoto({
  cover,
  placeName,
}: Readonly<{ cover: PlaceCover; placeName: string }>) {
  const main = `/media/p/${cover.photoId}/main`;
  const thumb = `/media/p/${cover.photoId}/w400`;
  // Zdjęcie nie szersze niż miniatura nie ma wyboru: jeden plik.
  const hasChoice = cover.width > THUMB_WIDTH;

  return (
    <figure className={styles.photo}>
      {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
      <img
        src={main}
        srcSet={hasChoice ? `${thumb} ${THUMB_WIDTH}w, ${main} ${cover.width}w` : undefined}
        sizes={hasChoice ? "(min-width: 48rem) 48rem, 100vw" : undefined}
        width={cover.width}
        height={cover.height}
        alt={placeName}
        decoding="async"
        fetchPriority="high"
      />
      <PhotoCredit photo={cover} />
    </figure>
  );
}
