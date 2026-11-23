"use client";

import { useState } from "react";

import type { PlaceThumb as Thumb } from "@/features/catalog/application/catalog-types";

import styles from "./album.module.css";

// Zdjęcie miejsca na kafelku miejsca w kolekcji: pierwsze zdjęcie miejsca, to samo co okładka na
// stronie miejsca. Wypełnia pole zdjęcia kafelka (`.photo` w kafelku, 4:3), przycięte stylami
// (`object-fit: cover`, Q4); panoramy i zdjęcia pionowe (proporcje poza 4:3–16:9) pokazujemy w
// całości na tle zastępczym. Zdjęcie jest ozdobą obok nazwy, która jest tekstem linku, więc
// `alt=""`; autor i licencja są pod zdjęciem na stronie miejsca, do której kafelek prowadzi.
// Natywne <img> z `w400` (wymiary z bazy rezerwują miejsce), ładowane leniwie. Komponent kliencki
// tylko po to, by przy błędzie pliku (np. 404) nie pokazać ikony zepsutego obrazka: wtedy zdjęcie
// znika i kafelek wygląda jak kafelek bez zdjęcia (samo tło zastępcze).
export function PlaceThumb({ thumb }: Readonly<{ thumb: Thumb | null }>) {
  const [failed, setFailed] = useState(false);

  if (thumb === null || failed) {
    return null;
  }

  const ratio = thumb.width / thumb.height;
  const whole = ratio < 4 / 3 || ratio > 16 / 9;

  return (
    <span className={styles.thumb}>
      {/* eslint-disable-next-line @next/next/no-img-element -- plik z własnej trasy, bez optymalizatora */}
      <img
        className={whole ? styles.thumbImageWhole : styles.thumbImage}
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
