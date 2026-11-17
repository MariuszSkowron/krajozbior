"use client";

import { useEffect, useRef, useState } from "react";

import { ErrorIcon } from "@/design-system/patterns/error-icon";

import { wasRestoredFromCache } from "./login-state";
import styles from "./login.module.css";

const EMAIL_KEY = "starter.login-email";

type LoginFormProps = Readonly<{
  returnTo?: string;
  /** Message for the failed attempt the server redirected back with. */
  errorMessage?: string;
  /** Whether the error concerns the entered values (wrong e-mail or password). */
  fieldsMarked?: boolean;
}>;

function remember(email: string) {
  try {
    sessionStorage.setItem(EMAIL_KEY, email);
  } catch {
    // The field is then simply empty after a failed attempt.
  }
}

function recall(): string | null {
  try {
    const email = sessionStorage.getItem(EMAIL_KEY);

    sessionStorage.removeItem(EMAIL_KEY);

    return email;
  } catch {
    return null;
  }
}

// Rendered by the signed-in account view: after a successful login no e-mail
// stays in the tab's storage.
export function ClearStoredEmail() {
  useEffect(() => {
    recall();
  }, []);

  return null;
}

// A native form post (works without JavaScript). With JavaScript the page also
// blocks a double submit, keeps the e-mail across the reload that shows the
// error (in sessionStorage, never in the URL) and moves focus to the message
// (WCAG 3.3.1, 3.3.3). The password is never kept.
export function LoginForm({ returnTo, errorMessage, fieldsMarked = false }: LoginFormProps) {
  const [pending, setPending] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const email = recall();

    if (errorMessage === undefined) {
      return;
    }

    if (email !== null && emailRef.current !== null) {
      emailRef.current.value = email;
    }

    errorRef.current?.focus();
  }, [errorMessage]);

  useEffect(() => {
    // Back to a page kept in the back/forward cache: the old response never comes.
    const onPageShow = (event: PageTransitionEvent) => {
      if (wasRestoredFromCache(event)) {
        setPending(false);
        recall();
      }
    };

    window.addEventListener("pageshow", onPageShow);

    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const fieldsInvalid = errorMessage !== undefined && fieldsMarked;
  const describedBy = fieldsInvalid ? "login-error" : undefined;
  const invalid = fieldsInvalid ? true : undefined;

  return (
    <form
      method="post"
      action="/api/auth/login"
      className={styles.form}
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();

          return;
        }

        remember(emailRef.current?.value ?? "");
        setPending(true);
      }}
    >
      {errorMessage === undefined ? null : (
        <p id="login-error" ref={errorRef} className={styles.error} role="alert" tabIndex={-1}>
          <span className={styles.errorPrefix}>
            <ErrorIcon />
            Błąd:{" "}
          </span>
          {errorMessage}
        </p>
      )}
      {returnTo === undefined ? null : <input type="hidden" name="returnTo" value={returnTo} />}
      <div className={styles.field}>
        <label htmlFor="email">E-mail</label>
        <input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Hasło</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid}
          aria-describedby={describedBy}
        />
      </div>
      <button
        type="submit"
        className={styles.submit}
        aria-disabled={pending}
        onClick={(event) => {
          // aria-disabled keeps the button focusable, so the click is stopped here.
          if (pending) {
            event.preventDefault();
          }
        }}
      >
        {pending ? "Logowanie…" : "Zaloguj się"}
      </button>
    </form>
  );
}
