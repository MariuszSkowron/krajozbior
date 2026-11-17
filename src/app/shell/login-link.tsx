"use client";

import { usePathname } from "next/navigation";

import styles from "../app-shell.module.css";

// After signing in the person returns to the page they were on; the login page
// itself and the start page need no return address.
export function accountLoginHref(pathname: string | null): string {
  return pathname === null || pathname === "/" || pathname.startsWith("/login")
    ? "/login"
    : `/login?returnTo=${encodeURIComponent(pathname)}`;
}

// A plain link (not next/link): the login page reads the session per request.
export function LoginLink() {
  return (
    <a className={styles.accountAction} href={accountLoginHref(usePathname())}>
      Zaloguj się
    </a>
  );
}
