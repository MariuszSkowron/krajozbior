import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, getRequestEmail, loginHref } from "@/app/request-actor";
import { getApprovedOrganizations } from "@/app/request-organizations";
import { LogoutForm } from "@/app/shell/logout-form";
import { REGION_LABELS } from "@/features/catalog/domain/collection";
import { CONTACT_EMAIL } from "@/features/legal/domain/legal-pages";
import { logFailure } from "@/lib/log-failure";
import { getRequestProfile } from "@/app/request-profile";
import { avatarLetter, formatDisplayName } from "@/features/profile/domain/display-name";
import { getMyStats } from "@/features/profile/application/stats";
import { formatKm } from "@/features/profile/domain/stats";
import { getProfileStatsDeps } from "@/features/profile/infrastructure/profile-deps";

import styles from "./profile.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Profil — Krajozbiór" };

// E9-1: the profile screen. The session is checked on the server, a guest is
// sent to /login and returns here afterwards. Only entries that lead to an
// existing screen are shown (D-22 point 7); "Ustawienia" arrived with its screen
// (E9-5), "Napisz do nas" with E9-6a (a mailto link to the team's address, no
// form and no data). Logging out is a native form
// post, so it works without JavaScript and ends the current session only.
export default async function MyPage() {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my"));
  }

  const loaded = await getRequestProfile();

  if (loaded.status !== "ok") {
    throw new Error("Profile could not be read");
  }

  const profile = loaded.value;
  // A failure of the counting (database) must not take the whole profile down: the tiles say
  // so, and the links and the logout stay usable. The actor is signed in here, so the
  // "unauthenticated" outcome cannot happen; if it did, it is shown the same way.
  let stats: Awaited<ReturnType<typeof getMyStats>> | null = null;

  try {
    stats = await getMyStats(actor, getProfileStatsDeps());
  } catch (error) {
    logFailure("Profile statistics", error);
    stats = null;
  }

  // The approved organizations make the account a curator. A failed lookup only leaves the
  // curator row out; the rest of the profile stays usable (like the statistics).
  let organizations: Awaited<ReturnType<typeof getApprovedOrganizations>> = [];

  try {
    organizations = await getApprovedOrganizations();
  } catch (error) {
    logFailure("Profile organizations", error);
  }

  // A curator or administrator without a name must not read "Odkrywca" right above their role
  // (the header says the neutral "Profil" in the same case); an explorer keeps "Odkrywca".
  const nameless = profile.firstName === null;
  const hasRole = actor.role === "admin" || organizations.length > 0;
  const showNeutralName = nameless && hasRole;

  const email = await getRequestEmail();
  const statsValue = stats !== null && stats.status === "ok" ? stats.value : null;

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1 id="profile-title">Profil</h1>
        <div className={styles.identity}>
          {/* The circle stands in for a photo until E4; the name beside it says the same. */}
          <span className={styles.avatar} aria-hidden="true">
            {showNeutralName ? "–" : avatarLetter(profile.firstName)}
          </span>
          <div className={styles.identityText}>
            <p className={styles.name} data-testid="profile-name">
              {showNeutralName
                ? "Bez imienia"
                : formatDisplayName(profile.firstName, profile.familyInitial)}
            </p>
            {profile.region === null ? null : (
              <p className={styles.role}>{REGION_LABELS[profile.region]}</p>
            )}
            {email === null ? null : (
              <p className={styles.visibility} data-testid="profile-email">
                {email}
              </p>
            )}
            <p className={styles.visibility}>Profil widzisz tylko Ty.</p>
          </div>
        </div>
        {actor.role === "admin" ? (
          <p className={styles.role} data-testid="profile-admin">
            <strong>Administrator</strong>
          </p>
        ) : null}
        {organizations.length === 0 ? null : (
          <div className={styles.curator} data-testid="profile-curator">
            <ul className={styles.curatorList}>
              {organizations.map((organization) => (
                <li key={organization.id}>
                  <strong>Kurator · {organization.name}</strong>
                </li>
              ))}
            </ul>
            <Link className={styles.curatorLink} href="/curator">
              Przejdź do panelu kuratora
              {/* D-54 (P21): panel jest na komputerze; dopisek znika od progu komputera (display:none, więc także dla czytnika). */}
              <span className={styles.phoneOnly}>&nbsp;(na komputerze)</span>
            </Link>
          </div>
        )}
      </header>
      <section className={styles.section} aria-labelledby="stats-title">
        <h2 id="stats-title">Twoje liczby</h2>
        {statsValue === null ? (
          <p className={styles.statsError} data-testid="profile-stats-error">
            Nie udało się wczytać Twoich liczb. Odśwież stronę za chwilę.
          </p>
        ) : (
          /* One definition list: a reader says "Odkryte miejsca, 12", the tiles only look like cards. */
          <dl className={styles.stats} data-testid="profile-stats">
            <div className={styles.stat}>
              <dt>Odkryte miejsca</dt>
              <dd data-testid="stat-places">{statsValue.visitedPlaces}</dd>
            </div>
            <div className={styles.stat}>
              <dt>Odkryte regiony</dt>
              <dd data-testid="stat-regions">{statsValue.regions}</dd>
            </div>
            <div className={styles.stat}>
              <dt>km w trasie (w linii prostej)</dt>
              <dd data-testid="stat-km">{formatKm(statsValue.kmInTransit)}</dd>
            </div>
          </dl>
        )}
      </section>
      <nav aria-labelledby="profile-title">
        <ul className={styles.links}>
          <li>
            <Link className={styles.link} href="/my/settings">
              Ustawienia
            </Link>
          </li>
          <li>
            <a className={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
              Napisz do nas
            </a>
          </li>
        </ul>
      </nav>
      {/* UX-06: „Wyloguj” jest tylko tutaj (na telefonie i na komputerze); nagłówek go nie ma. */}
      <div>
        <LogoutForm className="button button--outline">Wyloguj</LogoutForm>
      </div>
    </div>
  );
}
