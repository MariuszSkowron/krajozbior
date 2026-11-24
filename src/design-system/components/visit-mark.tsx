import type { ReactNode } from "react";

import styles from "./visit-mark.module.css";

// Znacznik odwiedzonego miejsca („Odwiedzone”, „Z przeszłości · marzec 2019”). Jeden wygląd
// (kolor i krój) na kafelku kolekcji, nad zdjęciem miejsca i w sekcji wizyty, żeby ten sam stan
// nie miał trzech wyglądów. Stan niesie tekst, nie sam kolor. Zostaje w design systemie, bo to
// znacznik stanu jak StatusBadge, bez logiki domenowej i bez odczytów.
export function VisitMark({ children }: Readonly<{ children: ReactNode }>) {
  return <span className={styles.mark}>{children}</span>;
}
