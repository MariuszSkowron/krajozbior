import type { HomeSummary } from "@/features/album/application/album-types";

import styles from "./home-sections.module.css";

// Podsumowanie albumu odkrywcy: trzy liczby (E12-Q5: bez „km w trasie” do czasu E9).
export function AlbumSummary({ summary }: Readonly<{ summary: HomeSummary }>) {
  return (
    <section className={`${styles.section} ${styles.album}`} aria-labelledby="album-title">
      <h2 id="album-title">Twój album</h2>
      <dl className={styles.summary}>
        <div className={styles.stat}>
          <dt>Odkryte miejsca</dt>
          <dd>{summary.discoveredPlaces}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Regiony</dt>
          <dd>{summary.regions}</dd>
        </div>
        <div className={styles.stat}>
          <dt>Zapisane kolekcje</dt>
          <dd>{summary.savedCollections}</dd>
        </div>
      </dl>
    </section>
  );
}
