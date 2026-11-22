import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getRequestActor, loginHref } from "@/app/request-actor";
import { getMyProfile } from "@/features/profile/application/profile";
import { PROFILE_DRAFT_COOKIE, parseProfileDraft } from "@/features/profile/domain/profile-draft";
import { getProfileDeps } from "@/features/profile/infrastructure/profile-deps";

import styles from "../profile.module.css";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Ustawienia — Krajozbiór" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// E9-5 and E9-2: the settings screen. Sections: "Profil" (first name, initial,
// region, visibility; E9-2) and "Konto" (the way to delete the account, E9-5);
// The theme is switched in the header (E9-4, server action; no "Wygląd" section here).
// No entry without an effect (D-22 point 7). The session is
// checked on the server; a guest is sent to /login.
export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/settings"));
  }

  const params = await searchParams;
  const result = first(params.profil);
  // The values typed into a refused form come back in a short-lived cookie, never in
  // the URL; they are used only right after a refusal.
  const draft =
    result === "blad" || result === "limit"
      ? parseProfileDraft((await cookies()).get(PROFILE_DRAFT_COOKIE)?.value)
      : null;
  const loaded = await getMyProfile(actor, getProfileDeps());

  if (loaded.status !== "ok") {
    throw new Error("Profile could not be read");
  }

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1>Ustawienia</h1>
      </header>
      <ProfileForm
        profile={loaded.value}
        result={result}
        fields={first(params.pola)}
        draft={draft}
      />
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
