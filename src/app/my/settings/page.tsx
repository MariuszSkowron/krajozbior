import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, loginHref } from "@/app/request-actor";

import styles from "../profile.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ustawienia — Krajozbiór" };

// E9-5: the minimal settings screen. It holds one section, "Konto", with the way
// to delete the account (docs#68, confirmation "in the settings"); E9-2 and E9-4
// add the sections "Profil" and "Wygląd". No entry without an effect (D-22
// point 7). The session is checked on the server; a guest is sent to /login.
export default async function SettingsPage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/settings"));
  }

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1>Ustawienia</h1>
      </header>
      <section aria-labelledby="settings-account" className={styles.section}>
        <h2 id="settings-account">Konto</h2>
        <ul className={styles.links}>
          <li>
            <Link className={styles.link} href="/my/delete-account">
              Usuń konto
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
