"use client";

import { usePathname } from "next/navigation";

import { entryPath, type LoginEntry } from "@/features/identity/domain/login-entry";

import styles from "../app-shell.module.css";

// After signing in (or creating the account) the person returns to the page they were on; the
// login pages themselves and the start page need no return address.
export function accountLoginHref(pathname: string | null, entry: LoginEntry = "login"): string {
  return pathname === null || pathname === "/" || pathname.startsWith("/login")
    ? entryPath(entry)
    : entryPath(entry, pathname);
}

// Plain links (not next/link): the login pages read the session per request. A guest sees the
// quiet "Zaloguj się" and the main "Załóż konto" (on a phone the banner and the buttons next to
// a collection or a place carry the second one, so the one-row header stays short).
export function LoginLink() {
  const pathname = usePathname();

  return (
    <>
      <a className={styles.accountAction} href={accountLoginHref(pathname)}>
        Zaloguj się
      </a>
      <a
        className={`button button--primary ${styles.signupAction}`}
        href={accountLoginHref(pathname, "signup")}
      >
        Załóż konto
      </a>
    </>
  );
}
