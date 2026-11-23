"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import styles from "../app-shell.module.css";

// The link to the profile in the header: the first name, or "Profil" without one. The
// accessible name starts with the visible text's context ("Profil: Anna"), so it contains the
// visible text (WCAG 2.5.3). A client component only to mark the current page: the layout is
// not drawn again on a client navigation.
export function ProfileLink({ name }: Readonly<{ name: string | null }>) {
  const current = usePathname() === "/my";

  return (
    <Link className={styles.profileLink} href="/my" aria-current={current ? "page" : undefined}>
      {name === null ? (
        "Profil"
      ) : (
        <>
          <span className={styles.visuallyHidden}>Profil: </span>
          <span className={styles.profileName}>{name}</span>
        </>
      )}
    </Link>
  );
}
