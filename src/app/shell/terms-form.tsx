"use client";

import { useRef, useState } from "react";

import { ErrorIcon } from "@/design-system/patterns/error-icon";

import styles from "./terms-gate.module.css";

const REQUIRED_MESSAGE = "Zaznacz pole „Akceptuję Regulamin”.";

// Formularz akceptacji regulaminu. Natywny dymek przeglądarki („Zaznacz to pole”) jest po
// angielsku albo w języku przeglądarki, więc formularz ma `noValidate`, a brak zaznaczenia
// zgłasza własny komunikat po polsku (WCAG 3.3.1): z JavaScriptem od razu, bez niego robi to
// serwer (parametr `zgoda=wymagana`). Pole dostaje fokus i opis błędu.
export function TermsForm({
  returnTo,
  serverProblem,
  termsVersion,
  termsDate,
}: Readonly<{
  returnTo: string;
  serverProblem?: string;
  termsVersion: string;
  termsDate: string;
}>) {
  const [clientProblem, setClientProblem] = useState<string | null>(null);
  const checkRef = useRef<HTMLInputElement>(null);
  const problem = clientProblem ?? serverProblem;
  const fieldInvalid = problem === REQUIRED_MESSAGE;

  return (
    <form
      method="post"
      action="/api/me/terms-acceptance"
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        if (checkRef.current?.checked === false) {
          event.preventDefault();
          setClientProblem(REQUIRED_MESSAGE);
          checkRef.current.focus();
        }
      }}
    >
      {problem === undefined ? null : (
        <p id="terms-error" role="alert" className={styles.error}>
          <span className={styles.errorPrefix}>
            <ErrorIcon />
            Błąd:{" "}
          </span>
          {problem}
        </p>
      )}
      <input type="hidden" name="returnTo" value={returnTo} />
      <label className={styles.check}>
        <input
          ref={checkRef}
          type="checkbox"
          name="accepted"
          required
          aria-invalid={fieldInvalid ? true : undefined}
          aria-describedby={fieldInvalid ? "terms-error" : undefined}
          onChange={() => setClientProblem(null)}
        />
        <span>
          Mam ukończone 16 lat. Akceptuję Regulamin (wersja {termsVersion} z dnia {termsDate}) i
          potwierdzam zapoznanie się z Polityką prywatności.
        </span>
      </label>
      <button type="submit" className={`button button--primary ${styles.submit}`}>
        Akceptuję
      </button>
    </form>
  );
}
