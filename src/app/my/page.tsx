import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, loginHref } from "@/app/request-actor";
import { LogoutForm } from "@/app/shell/logout-form";
import { roleLabels } from "@/features/identity/domain/role-home";

import styles from "./profile.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Profil — Krajozbiór" };

// E9-1: the profile screen. The session is checked on the server, a guest is
// sent to /login and returns here afterwards. Only entries that lead to an
// existing screen are shown (D-22 point 7); "Ustawienia" arrived with its screen
// (E9-5), "Napisz do nas" comes with E9-6. Logging out is a native form
// post, so it works without JavaScript and ends the current session only.
export default async function MyPage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my"));
  }

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1 id="profile-title">Profil</h1>
        <p className={styles.role}>
          Twoja rola: <strong>{roleLabels[actor.role]}</strong>
        </p>
      </header>
      <nav aria-labelledby="profile-title">
        <ul className={styles.links}>
          <li>
            <Link className={styles.link} href="/my/collections">
              Moje kolekcje
            </Link>
          </li>
          <li>
            <Link className={styles.link} href="/my/want-to-see">
              Chcę zobaczyć
            </Link>
          </li>
          <li>
            <Link className={styles.link} href="/my/settings">
              Ustawienia
            </Link>
          </li>
        </ul>
      </nav>
      <LogoutForm className="button button--outline">Wyloguj</LogoutForm>
    </div>
  );
}
