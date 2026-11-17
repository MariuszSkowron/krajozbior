"use client";

import styles from "./catalog.module.css";

// The error boundary of the public catalog pages. The pages throw when the
// database fails, so the answer is a server error (not a 200 page and not a
// 404); the text says nothing about the cause or about what exists.
export function CatalogError({ retry }: { retry: () => void }) {
  return (
    <div className={`content-width ${styles.page}`}>
      <h1>Nie udało się wczytać strony</h1>
      <p role="alert" className={styles.status}>
        Coś poszło nie tak po naszej stronie. Spróbuj ponownie za chwilę.
      </p>
      <button type="button" className={styles.retry} onClick={() => retry()}>
        Spróbuj ponownie
      </button>
    </div>
  );
}
