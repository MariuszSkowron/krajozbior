import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestActor, loginHref } from "@/app/request-actor";
import { LogoutForm } from "@/app/shell/logout-form";
import { DELETE_CONFIRMATION_WORD, isSignInFresh } from "@/features/account/domain/deletion";
import { getIdentityProvider } from "@/features/identity/infrastructure";

import styles from "./delete-account.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Usuń konto — Krajozbiór" };

const SCREEN = "/my/delete-account";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// What the refusal codes of the route mean for the person (the form posts
// natively and the route redirects back here with `?blad=`).
const messages: Record<string, string> = {
  managed_account:
    "Tego konta nie usuniesz samodzielnie: jesteś jedynym członkiem organizacji. Napisz do zespołu, a ustalimy, co zrobić z treściami organizacji.",
  invalid_confirmation: `Wpisz dokładnie słowo ${DELETE_CONFIRMATION_WORD}, aby potwierdzić usunięcie.`,
  invalid_request: "Nie udało się odczytać formularza. Spróbuj jeszcze raz.",
  unavailable:
    "Nie udało się usunąć konta. Konto zostało bez zmian, spróbuj jeszcze raz za chwilę.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// E9-5: the deletion screen. The session is checked on the server. The account
// of an administrator is removed by the operator (Q8), so the form is not shown
// to it. A sign-in older than 15 minutes asks for signing in again and comes
// back here (Q7). The form is a native post, so it works without JavaScript; the
// route decides everything and only the word is sent, never an account id.
export default async function DeleteAccountPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref(SCREEN));
  }

  const params = await searchParams;
  const code = first(params.blad);
  const message = code === undefined ? undefined : messages[code];

  if (actor.role === "admin") {
    return (
      <div className={`content-width ${styles.page}`}>
        <h1>Usuń konto</h1>
        <p>Konto administratora usuwa zespół, nie da się tego zrobić z aplikacji.</p>
        <Link className="button button--outline" href="/my/settings">
          Wróć do ustawień
        </Link>
      </div>
    );
  }

  const createdAt = await getIdentityProvider().getSessionCreatedAt(await headers());
  const fresh = isSignInFresh(createdAt, new Date());

  return (
    <div className={`content-width ${styles.page}`}>
      <h1>Usuń konto</h1>
      <p className={styles.warning}>
        <strong>Tego nie da się cofnąć.</strong> Konto zostanie usunięte od razu i w całości.
      </p>

      <section aria-labelledby="deletion-gone">
        <h2 id="deletion-gone">Co zniknie</h2>
        <ul className={styles.list}>
          <li>Twoje wizyty, zapisane kolekcje i lista „Chcę zobaczyć”.</li>
          <li>Twój adres e-mail i dane logowania, a także wszystkie sesje na urządzeniach.</li>
        </ul>
      </section>

      <section aria-labelledby="deletion-stays">
        <h2 id="deletion-stays">Co zostanie</h2>
        <ul className={styles.list}>
          <li>
            Techniczny zapis, że konto usunięto: sam numer konta, bez adresu e-mail i imienia.
          </li>
          <li>
            Liczniki zabezpieczające logowanie. Zawierają skrót adresu e-mail (a jeden także adres
            IP) i kasują się same po najwyżej 2 dniach.
          </li>
        </ul>
        <p>Tym samym adresem możesz później założyć nowe, puste konto.</p>
      </section>

      {message === undefined ? null : (
        <p role="alert" className={styles.error}>
          <span className={styles.errorPrefix}>Błąd:</span> {message}
        </p>
      )}

      {fresh ? (
        <form method="post" action="/api/me/account/deletion" className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="deletion-confirmation">
              Wpisz {DELETE_CONFIRMATION_WORD}, aby potwierdzić
            </label>
            <input
              id="deletion-confirmation"
              name="confirmation"
              type="text"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={code === "invalid_confirmation" ? "true" : undefined}
            />
          </div>
          <button className="button button--danger" type="submit">
            Usuń konto na stałe
          </button>
        </form>
      ) : (
        <section aria-labelledby="deletion-signin" className={styles.form}>
          <h2 id="deletion-signin">Zaloguj się ponownie</h2>
          <p>
            Z bezpieczeństwa konto usuniesz tylko po świeżym logowaniu (w ciągu ostatnich 15 minut).
            Zaloguj się kodem z e-maila, a wrócisz na ten ekran.
          </p>
          <LogoutForm className="button button--outline" returnTo={SCREEN}>
            Zaloguj się ponownie
          </LogoutForm>
        </section>
      )}

      <Link className={styles.back} href="/my/settings">
        Zrezygnuj i wróć do ustawień
      </Link>
    </div>
  );
}
