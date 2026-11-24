import type { ReactNode } from "react";

import styles from "./visit-mark.module.css";

// Znacznik odwiedzonego miejsca („Odwiedzone”, „Z przeszłości · marzec 2019”). Jeden wygląd
// na kafelku kolekcji, nad zdjęciem miejsca i w sekcji wizyty, żeby ten sam stan nie miał
// trzech kolorów. Stan niesie tekst, nie sam kolor; krój, rozmiar i wersaliki dziedziczy z otoczenia.
export function VisitMark({ children }: Readonly<{ children: ReactNode }>) {
  return <span className={styles.mark}>{children}</span>;
}
