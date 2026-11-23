"use client";

import { useState } from "react";

import type { PlaceThumb as Thumb } from "@/features/catalog/application/catalog-types";

import styles from "../../catalog.module.css";

// Miniatura zdjęcia miejsca na karcie miejsca w kolekcji: pierwsze zdjęcie miejsca, to samo co
// okładka na stronie miejsca. Karta bez zdjęcia nie ma miniatury (dotychczasowy wygląd). Zdjęcie
// jest ozdobą obok nazwy, która jest tekstem linku, więc `alt=""` (czytnik nie czyta nazwy
// dwa razy); autor i licencja są pod zdjęciem na stronie miejsca, do której karta prowadzi.
// Natywne <img> z `w400` (wymiary z bazy rezerwują miejsce), ładowane leniwie, bez przycinania.
// Komponent kliencki tylko po to, by przy błędzie pliku (np. 404) nie pokazać ikony zepsutego
// obrazka: wtedy miniatura znika i karta wygląda jak karta bez zdjęcia. Na serwerze renderuje się
// tak samo jak przedtem (pole 16:9 z <img>), więc układ nie skacze podczas ładowania.
export function PlaceThumb({ thumb }: Readonly<{ thumb: Thumb | null }>) {
  const [failed, setFailed] = useState(false);

  if (thumb === null || failed) {
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
        onError={() => setFailed(true)}
      />
    </span>
  );
}
