import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { getRequestActor } from "@/app/request-actor";
import { LogoutForm } from "@/app/shell/logout-form";
import { shouldListDemoAccounts } from "@/features/identity/domain/demo-account-list";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { roleHome, roleLabels } from "@/features/identity/domain/role-home";
import { findSeededDemoAccounts } from "@/features/identity/infrastructure/demo-accounts";
import { logFailure } from "@/lib/log-failure";

import { CodeForms } from "./code-forms";
import { LOGIN_EMAIL_COOKIE, loginEmailFromCookie } from "./login-email-cookie";
import { ClearStoredEmail, LoginForm } from "./login-form";
import {
  codeMessage,
  isCodeError,
  marksCodeInvalid,
  marksFieldsInvalid,
  passwordMessage,
} from "./login-state";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

// One session lookup per request, shared by the shell, the title and the page.
const getActor = getRequestActor;

// The title names the view a signed-in user actually sees (WCAG 2.4.2).
// The login screen is kept out of search results (E11-Q15 A).
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getActor()) === null ? "Logowanie — Krajozbiór" : "Konto — Krajozbiór",
    robots: { index: false, follow: true },
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Without seeded accounts there is nothing to show.
async function listDemoAccounts() {
  if (!shouldListDemoAccounts(process.env.NODE_ENV)) {
    return [];
  }

  try {
    return await findSeededDemoAccounts();
  } catch (error) {
    logFailure("Demo account lookup", error);
    // The form still works without the list.
    return [];
  }
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const returnTo = requestedReturnTo(first(params.returnTo)) ?? undefined;
  const errorCode = first(params.error);
  const codeSent = first(params.kod) === "wyslany";
  const actor = await getActor();

  if (actor !== null) {
    return (
      <div className={`content-width ${styles.page}`}>
        <ClearStoredEmail />
        <h1>Konto</h1>
        <p>
          <Link href={roleHome(actor.role)} className={styles.link}>
            Przejdź do profilu
          </Link>
        </p>
        <LogoutForm className={`button button--outline ${styles.submit}`}>Wyloguj</LogoutForm>
      </div>
    );
  }

  const email = loginEmailFromCookie((await cookies()).get(LOGIN_EMAIL_COOKIE)?.value);
  const accounts = await listDemoAccounts();
  const passwordError = passwordMessage(errorCode);

  return (
    <div className={`content-width ${styles.page}`}>
      <h1>Logowanie</h1>
      {email === null ? <p>Podaj adres e-mail, a wyślemy Ci kod logowania.</p> : null}
      <p>
        Konto założysz przy pierwszym logowaniu; zaraz potem poprosimy o akceptację regulaminu.
        Zasady serwisu:{" "}
        <Link href="/regulamin" className={styles.textLink}>
          Regulamin
        </Link>{" "}
        i{" "}
        <Link href="/polityka-prywatnosci" className={styles.textLink}>
          Polityka prywatności
        </Link>
        .
      </p>

      <section aria-label="Logowanie kodem z e-maila" className={styles.section}>
        <CodeForms
          returnTo={returnTo}
          email={email}
          codeSent={codeSent}
          codeInvalid={marksCodeInvalid(errorCode)}
          errorMessage={isCodeError(errorCode) ? codeMessage(errorCode) : undefined}
        />
      </section>

      <details
        className={`${styles.section} ${styles.passwordToggle}`}
        open={passwordError !== undefined && !isCodeError(errorCode) ? true : undefined}
      >
        <summary>Logowanie hasłem</summary>
        <p>Dla kont administratorów i kont demonstracyjnych.</p>
        <LoginForm
          returnTo={returnTo}
          errorMessage={isCodeError(errorCode) ? undefined : passwordError}
          fieldsMarked={marksFieldsInvalid(errorCode)}
        />
      </details>

      {accounts.length > 0 ? (
        <section aria-labelledby="demo-accounts" className={styles.section}>
          <h2 id="demo-accounts">Konta demonstracyjne</h2>
          <p>Hasło jest w zmiennej DEMO_ACCOUNT_PASSWORD lokalnego środowiska.</p>
          <ul>
            {accounts.map(({ email, role }) => (
              <li key={email}>
                {roleLabels[role]}: <code>{email}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
