"use client";

import styles from "./curator.module.css";

// The error state of the panel: no technical detail reaches the screen.
export default function CuratorError({ reset }: Readonly<{ error: Error; reset: () => void }>) {
  return (
    <div className={styles.state} role="alert">
      <h1>Nie udało się wczytać panelu</h1>
      <p>Spróbuj jeszcze raz. Jeśli problem wraca, wróć do tego później.</p>
      <div className={styles.actions}>
        <button type="button" className="button button--primary" onClick={reset}>
          Spróbuj jeszcze raz
        </button>
      </div>
    </div>
  );
}
