import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getRequestActor, loginHref } from "@/app/request-actor";
import { roleLabels } from "@/features/identity/domain/role-home";

import styles from "../home.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moje konto — Starter" };

// The pattern of a private page: the session is checked on the server, a guest
// is sent to /login and returns here afterwards. Replace the content with the
// product's own; load the data through withUserContext (src/lib/db).
export default async function MyPage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my"));
  }

  return (
    <div className={`content-width ${styles.page}`}>
      <section className={styles.hero} aria-labelledby="my-title">
        <h1 id="my-title">Moje konto</h1>
        <p className={styles.lead}>
          Twoja rola: <strong>{roleLabels[actor.role]}</strong>.
        </p>
      </section>
    </div>
  );
}
