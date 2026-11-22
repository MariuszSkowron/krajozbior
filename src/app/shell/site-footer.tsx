import { CONTACT_EMAIL, LEGAL_PAGES } from "@/features/legal/domain/legal-pages";

import styles from "../app-shell.module.css";
import { ReportContentLink } from "../report-content-link";

// Stopka powłoki (F-K3, spec E11 5.9): regulamin, polityka prywatności, najważniejsze zasady
// i kontakt, na komputerze i na telefonie. Oświadczenie o zdjęciach jest osiągalne z regulaminu
// (załącznik nr 1). Odnośniki są zwykłymi kotwicami: pełne wczytanie strony rysuje powłokę od
// nowa, więc ekranu akceptacji nie da się ominąć nawigacją bez przeładowania.
const FOOTER_SLUGS = ["regulamin", "polityka-prywatnosci", "zasady"] as const;

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <nav aria-label="Informacje prawne i kontakt" className="content-width-wide">
        <ul className={styles.footerList}>
          {LEGAL_PAGES.filter((page) =>
            (FOOTER_SLUGS as readonly string[]).includes(page.slug),
          ).map((page) => (
            <li key={page.slug}>
              <a className={styles.footerLink} href={page.path}>
                {page.title}
              </a>
            </li>
          ))}
          <li>
            <a className={styles.footerLink} href="/zrodla">
              Źródła danych
            </a>
          </li>
          <li>
            <ReportContentLink className={styles.footerLink} />
          </li>
          <li>
            <a className={styles.footerLink} href={`mailto:${CONTACT_EMAIL}`}>
              Kontakt
            </a>
          </li>
        </ul>
      </nav>
    </footer>
  );
}
