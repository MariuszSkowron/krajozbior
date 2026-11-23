import type { PlaceThumb as Thumb } from "@/features/catalog/application/catalog-types";

import styles from "../../catalog.module.css";

// Miniatura zdjęcia miejsca na karcie miejsca w kolekcji: pierwsze zdjęcie miejsca, to samo co
// okładka na stronie miejsca. Karta bez zdjęcia nie ma miniatury (dotychczasowy wygląd). Zdjęcie
// jest ozdobą obok nazwy, która jest tekstem linku, więc `alt=""` (czytnik nie czyta nazwy
// dwa razy); autor i licencja są pod zdjęciem na stronie miejsca, do której karta prowadzi.
// Natywne <img> z `w400` (wymiary z bazy rezerwują miejsce), ładowane leniwie, bez przycinania.
export function PlaceThumb({ thumb }: Readonly<{ thumb: Thumb | null }>) {
  if (thumb === null) {
    return null;
  }

  return (
    <span className={styles.thumb}>
      {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
      <img
        className={styles.thumbImage}
        src={`/media/p/${thumb.photoId}/w400`}
        width={thumb.width}
        height={thumb.height}
        alt=""
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
