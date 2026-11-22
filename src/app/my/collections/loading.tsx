import styles from "./collections.module.css";

// A skeleton of the page (title, filter, cards) instead of an empty screen with a sentence; the
// status text is for screen readers only.
export default function Loading() {
  return (
    <div className={`content-width ${styles.skeleton}`} role="status" aria-busy="true">
      <span className={styles.visuallyHidden}>Wczytuję Twoje kolekcje…</span>
      <div className={`${styles.skeletonBlock} ${styles.skeletonTitle}`} aria-hidden="true" />
      <div className={`${styles.skeletonBlock} ${styles.skeletonFilter}`} aria-hidden="true" />
      <div className={styles.grid} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div key={index} className={`${styles.skeletonBlock} ${styles.skeletonCard}`} />
        ))}
      </div>
    </div>
  );
}
