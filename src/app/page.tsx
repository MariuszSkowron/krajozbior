import Link from "next/link";

import { getRequestActor, logActorFailure } from "@/app/request-actor";

import styles from "./home.module.css";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The neutral start page of the krajozbior: replace it with the product's own.
// It reads the session only to choose the action; a failed lookup shows the
// guest version.
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const actor = await getRequestActor().catch((error: unknown) => {
    logActorFailure(error);
    return null;
  });
  const signedOut = first(params.wylogowano) === "1";
  const signOutFailed = first(params.wylogowanie) === "blad";

  return (
    <div className={`content-width ${styles.page}`}>
      {signedOut ? (
        <p role="status" className={styles.status}>
          Wylogowano.
        </p>
      ) : null}
      {signOutFailed ? (
        <p role="status" className={styles.status}>
          Nie udało się wylogować. Spróbuj ponownie.
        </p>
      ) : null}
      <section className={styles.hero} aria-labelledby="start-title">
        <h1 id="start-title">Witaj w aplikacji</h1>
        <p className={styles.lead}>
          To pusta strona startowa szkieletu. Logowanie, sesje i reguły dostępu do danych już
          działają; treść produktu powstaje w kolejnych zadaniach.
        </p>
        <div className={styles.actions}>
          {actor === null ? (
            <Link className="button button--primary" href="/login">
              Zaloguj się
            </Link>
          ) : (
            <Link className="button button--primary" href="/my">
              Moje konto
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
