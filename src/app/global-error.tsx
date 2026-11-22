"use client";

import "@/design-system/tokens/tokens.css";
import "@/design-system/theme/theme.css";

import styles from "./catalog.module.css";

// Granica błędów samej powłoki (QA-5): zastępuje cały dokument, gdy zawiedzie układ strony
// (np. baza danych przy odczycie sesji). Nie ma tu powłoki, motywu z ciasteczka ani czcionek,
// więc ekran jest prosty: nocny motyw domyślny, polski tekst, jeden przycisk. Tekst nic nie
// mówi o przyczynie.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="pl" className="theme-dark">
      <body>
        <main className={`content-width ${styles.page}`}>
          <title>Nie udało się wczytać strony — Krajozbiór</title>
          <h1>Nie udało się wczytać strony</h1>
          <p role="alert" className={styles.status}>
            Spróbuj ponownie za chwilę.
          </p>
          <button
            type="button"
            className={`button button--outline ${styles.retry}`}
            onClick={() => retry()}
          >
            Spróbuj ponownie
          </button>
        </main>
      </body>
    </html>
  );
}
