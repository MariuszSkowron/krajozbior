import { ErrorIcon } from "@/design-system/patterns/error-icon";

import styles from "./login.module.css";

type CodeFormsProps = Readonly<{
  returnTo?: string;
  /** The code was requested: the second step is shown first. */
  codeSent: boolean;
  /** Message for the failed step the server redirected back with. */
  errorMessage?: string;
}>;

// Sign-in with a code sent by e-mail, in two native forms (works without
// JavaScript): ask for the code, then enter it together with the address. The
// first sign-in creates the account.
export function CodeForms({ returnTo, codeSent, errorMessage }: CodeFormsProps) {
  const returnField =
    returnTo === undefined ? null : <input type="hidden" name="returnTo" value={returnTo} />;

  return (
    <>
      {errorMessage === undefined ? null : (
        <p id="code-error" className={styles.error} role="alert">
          <span className={styles.errorPrefix}>
            <ErrorIcon />
            Błąd:{" "}
          </span>
          {errorMessage}
        </p>
      )}
      {codeSent ? (
        <p role="status" className={styles.status}>
          Jeśli adres jest poprawny, wysłaliśmy na niego kod. Wpisz go poniżej. Jeśli wiadomość nie
          dotrze w ciągu kilku minut, sprawdź folder spam albo poproś o kod jeszcze raz.
        </p>
      ) : null}
      <form method="post" action="/api/auth/code/request" className={styles.form}>
        {returnField}
        <div className={styles.field}>
          <label htmlFor="code-request-email">E-mail</label>
          <input id="code-request-email" name="email" type="email" autoComplete="email" required />
        </div>
        <button type="submit" className={`button button--primary ${styles.submit}`}>
          Wyślij kod
        </button>
      </form>
      <form method="post" action="/api/auth/code/verify" className={styles.form}>
        {returnField}
        <div className={styles.field}>
          <label htmlFor="code-verify-email">E-mail, na który przyszedł kod</label>
          <input id="code-verify-email" name="email" type="email" autoComplete="email" required />
        </div>
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
          />
        </div>
        <button type="submit" className={`button button--primary ${styles.submit}`}>
          Zaloguj się kodem
        </button>
      </form>
    </>
  );
}
