import Link from "next/link";
import type { ReactNode } from "react";

import { StatusBadge } from "@/design-system/components/status-badge";

import { CuratorMenuLink } from "./curator-menu-link";
import styles from "./curator.module.css";
import { UnsavedChangesProvider } from "./unsaved-changes";

// The frame of every panel screen. The panel is for a computer (product.md):
// below the desktop threshold the page says so instead of showing a cramped
// editor. The content stays out of the DOM tree for assistive technology there
// (display: none), so a phone user hears the notice and nothing else. On a
// computer the panel has its own menu (the side menu of the shell gives way to
// it): the role badge, the list of collections and a link to the private profile.
export default function CuratorLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <UnsavedChangesProvider>
      <div className="content-width-wide">
        <p className={styles.phoneNotice} role="note">
          Panel kuratora jest przeznaczony na komputer. Otwórz tę stronę na większym ekranie.{" "}
          <Link href="/my">Przejdź do profilu</Link>
        </p>
        <div className={styles.frame}>
          <nav className={styles.menu} aria-label="Panel kuratora">
            <StatusBadge tone="info">Kurator</StatusBadge>
            <ul className={styles.menuList}>
              <li>
                <CuratorMenuLink className={styles.menuLink}>Kolekcje</CuratorMenuLink>
              </li>
            </ul>
            <Link className={`${styles.menuLink} ${styles.menuProfile}`} href="/my">
              Mój album
            </Link>
          </nav>
          <div className={styles.panel}>{children}</div>
        </div>
      </div>
    </UnsavedChangesProvider>
  );
}
