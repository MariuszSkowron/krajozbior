import type { ReactNode } from "react";

import type { HomeBannerPick } from "@/features/catalog/application/catalog-types";

import styles from "./auth-photo.module.css";
import { BannerCredit, BannerPhoto } from "./home/home-banner";

// Dwie kolumny ekranów wejścia (logowanie, zakładanie konta, akceptacja regulaminu): formularz
// i zdjęcie z puli banera strony głównej z jednym zdaniem korzyści i podpisem zdjęcia jak na
// banerze. Na telefonie jedna kolumna: zdjęcie pod formularzem. Bez zdjęcia (pusta pula albo
// nieudany odczyt) zostaje spokojne tło zastępcze ze zdaniem.
export function AuthTwoColumns({
  photo,
  sentence,
  children,
}: Readonly<{ photo: HomeBannerPick | null; sentence: string; children: ReactNode }>) {
  return (
    <div className={styles.layout}>
      <div className={styles.formColumn}>{children}</div>
      <figure
        className={`${styles.panel} ${photo === null ? styles.plain : styles.withPhoto}`}
        aria-label="Zdjęcie miejsca"
      >
        {photo === null ? null : (
          <BannerPhoto cover={photo} alt={photo.altText} className={styles.photo} />
        )}
        <div className={styles.text}>
          <p className={styles.sentence}>{sentence}</p>
          {photo === null ? null : <BannerCredit cover={photo} className={styles.credit} />}
        </div>
      </figure>
    </div>
  );
}
