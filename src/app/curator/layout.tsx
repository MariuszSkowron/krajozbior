import type { ReactNode } from "react";

import styles from "./curator.module.css";

// The frame of every panel screen. The panel is for a computer (product.md):
// below the desktop threshold the page says so instead of showing a cramped
// editor. The content stays out of the DOM tree for assistive technology there
// (display: none), so a phone user hears the notice and nothing else.
export default function CuratorLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="content-width-wide">
      <p className={styles.phoneNotice} role="note">
        Panel kuratora jest przeznaczony na komputer. Otwórz tę stronę na większym ekranie.
      </p>
      <div className={styles.panel}>{children}</div>
    </div>
  );
}
