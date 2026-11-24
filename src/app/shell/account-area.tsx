import Link from "next/link";

import type { Role } from "@/features/identity/domain/actor";

import styles from "../app-shell.module.css";
import { GuestNewsLink } from "./guest-news-link";
import { LoginLink } from "./login-link";
import { LogoutForm } from "./logout-form";

// Account area next to the application name. A signed-in account sees "Administrator" for an
// administrator and "Kurator · {organizacja}" as the link to the panel for a member of an
// approved organization (on a computer; a phone keeps the one-row header). "Profil" is only in
// the menu and "Wyloguj" is on the profile (UX-06); the header keeps the quiet "Wyloguj" only
// when there is no menu (`showLogout`: the screen before the terms are accepted). A guest sees
// "Zaloguj się". Logging out is a native form, so it works without JavaScript.
export function AccountArea({
  role,
  curatorOrganization = null,
  showLogout = false,
}: Readonly<{
  role: Role | null;
  curatorOrganization?: string | null;
  showLogout?: boolean;
}>) {
  return (
    <div className={styles.account}>
      {role === null ? (
        <>
          <GuestNewsLink />
          <LoginLink />
        </>
      ) : (
        <>
          {role === "admin" ? (
            <p className={styles.role} data-role="admin">
              <svg
                className={styles.roleIcon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
              </svg>
              <span className={styles.roleText}>Administrator</span>
            </p>
          ) : null}
          {curatorOrganization === null ? null : (
            <Link className={`${styles.accountAction} ${styles.curatorLink}`} href="/curator">
              <span className={styles.curatorText}>Kurator · {curatorOrganization}</span>
            </Link>
          )}
          {showLogout ? <LogoutForm className={styles.logoutAction}>Wyloguj</LogoutForm> : null}
        </>
      )}
    </div>
  );
}
