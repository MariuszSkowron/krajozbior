import { ErrorIcon } from "@/design-system/patterns/error-icon";

import { changeLoginAddress } from "./actions";
import { maskEmail } from "./login-email-cookie";
import styles from "./login.module.css";

type CodeFormsProps = Readonly<{
  returnTo?: string;
  /** The address typed in step 1 (from the short-lived cookie): step 2 is shown. */
  email: string | null;
  /** The code was just requested: the status message is shown. */
  codeSent: boolean;
  /** Message for the failed step the server redirected back with. */
  errorMessage?: string;
}>;

// Sign-in with a code sent by e-mail, in native forms (works without JavaScript). Step 1 asks for
// the address, step 2 for the code; the address is entered once and kept in a cookie between the
// steps (login-email-cookie.ts), never in the URL. The first sign-in creates the account.
export function CodeForms({ returnTo, email, codeSent, errorMessage }: CodeFormsProps) {
  const returnField =
    returnTo === undefined ? null : <input type="hidden" name="returnTo" value={returnTo} />;
  const error =
    errorMessage === undefined ? null : (
      <p id="code-error" className={styles.error} role="alert">
        <span className={styles.errorPrefix}>
          <ErrorIcon />
          Błąd:{" "}
        </span>
        {errorMessage}
      </p>
    );

  if (email === null) {
    return (
      <>
        {error}
        <form method="post" action="/api/auth/code/request" className={styles.form}>
          {returnField}
          <div className={styles.field}>
            <label htmlFor="code-request-email">E-mail</label>
            <input
              id="code-request-email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </div>
          <button type="submit" className={`button button--primary ${styles.submit}`}>
            Wyślij kod
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      {error}
      <p id="code-hint">
        Wpisz kod wysłany na adres <strong>{maskEmail(email)}</strong>.
      </p>
      {codeSent ? (
        <p role="status" className={styles.status}>
          Jeśli adres jest poprawny, kod jest już w drodze. Nie ma go po kilku minutach? Sprawdź
          folder spam albo wyślij kod ponownie.
        </p>
      ) : null}
      <form method="post" action="/api/auth/code/verify" className={styles.form}>
        {returnField}
        <input type="hidden" name="email" value={email} />
        <div className={styles.field}>
          <label htmlFor="code-verify-code">Kod z wiadomości (6 cyfr)</label>
          <input
            id="code-verify-code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            aria-describedby="code-hint"
          />
        </div>
        <button type="submit" className={`button button--primary ${styles.submit}`}>
          Zaloguj się
        </button>
      </form>
      <div className={styles.stepActions}>
        <form method="post" action="/api/auth/code/request">
          {returnField}
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="button button--outline">
            Wyślij kod ponownie
          </button>
        </form>
        <form action={changeLoginAddress}>
          {returnField}
          <button type="submit" className="button button--outline">
            Zmień adres
          </button>
        </form>
      </div>
    </>
  );
}
