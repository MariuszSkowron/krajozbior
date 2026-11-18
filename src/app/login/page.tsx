import type { Metadata } from "next";
import Link from "next/link";

import { getRequestActor } from "@/app/request-actor";
import { LogoutForm } from "@/app/shell/logout-form";
import { shouldListDemoAccounts } from "@/features/identity/domain/demo-account-list";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { roleHome, roleLabels } from "@/features/identity/domain/role-home";
import { findSeededDemoAccounts } from "@/features/identity/infrastructure/demo-accounts";
import { logFailure } from "@/lib/log-failure";

import { CodeForms } from "./code-forms";
import { ClearStoredEmail, LoginForm } from "./login-form";
import { codeMessage, isCodeError, marksFieldsInvalid, passwordMessage } from "./login-state";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";

// One session lookup per request, shared by the shell, the title and the page.
const getActor = getRequestActor;

// The title names the view a signed-in user actually sees (WCAG 2.4.2).
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getActor()) === null ? "Logowanie — Krajozbiór" : "Konto — Krajozbiór" };
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
          Twoja rola: <strong>{roleLabels[actor.role]}</strong>.
        </p>
        <p>
          <Link href={roleHome(actor.role)} className={styles.link}>
            Przejdź do swojego konta
          </Link>
        </p>
        <LogoutForm className={`button button--outline ${styles.submit}`}>Wyloguj</LogoutForm>
      </div>
    );
  }

  const accounts = await listDemoAccounts();
  const passwordError = passwordMessage(errorCode);

  return (
    <div className={`content-width ${styles.page}`}>
      <h1>Logowanie</h1>
      <p>Zaloguj się, aby kontynuować.</p>

      <section aria-labelledby="code-sign-in" className={styles.section}>
        <h2 id="code-sign-in">Kod na e-mail</h2>
        <CodeForms
          returnTo={returnTo}
          codeSent={codeSent}
          errorMessage={isCodeError(errorCode) ? codeMessage(errorCode) : undefined}
        />
      </section>

      <section aria-labelledby="password-sign-in" className={styles.section}>
        <h2 id="password-sign-in">Hasło</h2>
        <p>Dla kont administratorów i kont demonstracyjnych.</p>
        <LoginForm
          returnTo={returnTo}
          errorMessage={isCodeError(errorCode) ? undefined : passwordError}
          fieldsMarked={marksFieldsInvalid(errorCode)}
        />
      </section>

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
