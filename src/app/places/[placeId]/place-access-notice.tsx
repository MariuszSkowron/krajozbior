import { useId } from "react";

import { accessNotice } from "@/features/catalog/domain/place-access-notice";
import type { AccessRestriction } from "@/features/catalog/domain/place";

import styles from "./place-access-notice.module.css";

// Spokojna informacja o terenie miejsca prywatnego, ogrodzonego lub w ruinie (E1-S11, R-14):
// nazwa stanu pogrubionym tekstem (słowo niesie znaczenie, nie kolor; odznaka `StatusBadge` na
// tle ostrzeżenia nie spełnia kontrastu, więc sekcja jej nie używa) i jedno zdanie. Miejsce bez
// ograniczenia nie ma tej sekcji. Poziom nagłówka zależy od miejsca: `h2` na stronie miejsca,
// `h3` w panelu miejsca (jego tytuł jest już `h2`). Sekcja jest zwykłą treścią strony, nie
// komunikatem na żywo: odkrywca czyta ją w kolejności dokumentu.
export function PlaceAccessNotice({
  restriction,
  headingLevel = 2,
}: Readonly<{ restriction: AccessRestriction; headingLevel?: 2 | 3 }>) {
  const headingId = useId();
  const notice = accessNotice(restriction);

  if (notice === null) {
    return null;
  }

  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <section
      className={styles.notice}
      aria-labelledby={headingId}
      data-testid="place-access-notice"
    >
      <Heading id={headingId} className={styles.title}>
        Wejście na teren
      </Heading>
      <p>
        <strong className={styles.state}>{notice.title}</strong>
      </p>
      <p>{notice.text}</p>
    </section>
  );
}
