import type { PlaceCover } from "@/features/catalog/application/catalog-types";
import { THUMB_WIDTH } from "@/features/media/domain/limits";

import { PhotoCredit } from "../../places/[placeId]/photo-credit";
import styles from "./collection-cover.module.css";

// Okładka w nagłówku kolekcji (E4-3, docs#39 AC1): zdjęcie wybrane przez kuratora z podpisem
// (autor, licencja, źródło, informacja o zmianach, jak na stronie miejsca). Natywne <img> z
// `srcset`: miniatura `w400` dla wąskich ekranów, plik `main` dla szerokich. Wymiary z bazy
// rezerwują miejsce. Tekst alternatywny to opis zdjęcia (tytuł z Commons albo nazwa miejsca);
// zdjęcia nie przycinamy, bo podpis mówi, że tylko je zmniejszamy.
export function CollectionCover({ cover }: Readonly<{ cover: PlaceCover }>) {
  const main = `/media/p/${cover.photoId}/main`;
  const thumb = `/media/p/${cover.photoId}/w400`;
  const hasChoice = cover.width > THUMB_WIDTH;

  return (
    <figure className={styles.cover}>
      {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
      <img
        src={main}
        srcSet={hasChoice ? `${thumb} ${THUMB_WIDTH}w, ${main} ${cover.width}w` : undefined}
        sizes={hasChoice ? "(min-width: 48rem) 48rem, 100vw" : undefined}
        width={cover.width}
        height={cover.height}
        alt={cover.altText}
        decoding="async"
        fetchPriority="high"
      />
      <PhotoCredit photo={cover} />
    </figure>
  );
}
