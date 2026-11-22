"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "../app-shell.module.css";
import { activeNavHref } from "./nav-items";

// Wejście gościa do aktualności (Q16, B4): odnośnik w nagłówku, tylko dla `role === null`.
// Zalogowany ma piątą pozycję paska, a zalogowany bez akceptacji regulaminu nie dostaje
// żadnego z nich. Na liście i stronie aktualności odnośnik ma `aria-current="page"`.
export function GuestNewsLink() {
  const current = activeNavHref(usePathname() ?? "") === "/news";

  return (
    <Link className={styles.headerLink} href="/news" aria-current={current ? "page" : undefined}>
      Aktualności
    </Link>
  );
}
