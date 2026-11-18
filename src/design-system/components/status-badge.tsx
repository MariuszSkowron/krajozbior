import type { ReactNode } from "react";

import styles from "./status-badge.module.css";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

// Pigułka ze stanem (np. „Opublikowana”, „Szkic”, rodzaj wizyty). Niezmiennik dostępności:
// stan zawsze niesie słowo, nigdy sam kolor, więc komponent wymaga treści. Tło stanu
// (`color.feedback.*.bg`) jest nakładane na tło, na którym odznaka stoi. W jasnym motywie
// odznaka stoi tylko na `color.surface.card`; `success` wyłącznie tam, a pozostałe także na
// `color.surface.canvas` (reguła tła, docs/design/accessibility.md).
export function StatusBadge({
  tone,
  children,
}: Readonly<{ tone: StatusTone; children: ReactNode }>) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}
