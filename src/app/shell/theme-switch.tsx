import styles from "../app-shell.module.css";
import { setTheme } from "./theme-actions";
import type { Theme } from "./theme";

// Natywny formularz (działa bez JavaScriptu): przycisk mówi, co się stanie po kliknięciu.
// Nazwa dostępna to sam napis, bez aria-pressed (stan wynika z treści przycisku).
export function ThemeSwitch({ theme }: Readonly<{ theme: Theme }>) {
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Jasny motyw" : "Nocny motyw";

  return (
    <form action={setTheme} className={styles.themeSwitch}>
      <button className={styles.themeButton} type="submit" name="theme" value={next} title={label}>
        <svg
          className={styles.themeIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          {next === "light" ? (
            <>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
            </>
          ) : (
            <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
          )}
        </svg>
        <span className={styles.themeText}>{label}</span>
      </button>
    </form>
  );
}
