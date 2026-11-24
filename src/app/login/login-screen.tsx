import { cookies } from "next/headers";
import Link from "next/link";

import { loadAuthPhoto } from "@/app/auth-photo-loader";
import { AuthTwoColumns } from "@/app/auth-photo";
import { getApprovedOrganizations } from "@/app/request-organizations";
import { getRequestActor } from "@/app/request-actor";
import { LogoutForm } from "@/app/shell/logout-form";
import { shouldListDemoAccounts } from "@/features/identity/domain/demo-account-list";
import type { LoginEntry } from "@/features/identity/domain/login-entry";
import { requestedReturnTo } from "@/features/identity/domain/return-to";
import { roleLabels, signInDestination } from "@/features/identity/domain/role-home";
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

// A signed-in curator is sent to the panel, like right after signing in. A failed read
// only changes the link to the profile.
async function isCuratorAccount(): Promise<boolean> {
  try {
    return (await getApprovedOrganizations()).length > 0;
  } catch (error) {
    logFailure("Curator link on the account screen", error);

    return false;
  }
}

// Texts of the two entrances to the one e-mail code mechanism (the code step is shared).
const ENTRY_TEXTS = {
  login: {
    title: "Zaloguj się",
    intro: "Podaj adres e-mail konta. Wyślemy na niego kod.",
    sentence: "Wracasz do swojego albumu.",
  },
  signup: {
    title: "Załóż konto",
    intro: "Podaj adres e-mail. Wyślemy Ci kod, którym go potwierdzisz. Hasła nie potrzebujesz.",
    sentence: "Bezpłatnie i bez reklam: zapisujesz kolekcje, potwierdzasz wizyty i widzisz postęp.",
  },
} as const;

// The screen of both entrances: "Zaloguj się" (/login) and "Załóż konto" (/login/zaloz-konto).
// The mechanism is one (the code forms and the routes under /api/auth/code); the entrance only
// changes the headings, the texts and the page the forms return to. On a computer the form has
// the photo of the home banner pool beside it.
export async function LoginScreen({
  entry,
  searchParams,
}: Readonly<{ entry: LoginEntry; searchParams: SearchParams }>) {
  const params = await searchParams;
  const returnTo = requestedReturnTo(first(params.returnTo)) ?? undefined;
  const errorCode = first(params.error);
  const codeSent = first(params.kod) === "wyslany";
  const actor = await getRequestActor();

  if (actor !== null) {
    const isCurator = await isCuratorAccount();

    return (
      <div className={`content-width ${styles.page}`}>
        <ClearStoredEmail />
        <h1>Konto</h1>
        <p>
          <Link href={signInDestination({ returnTo: null, isCurator })} className={styles.link}>
            {isCurator ? "Przejdź do panelu kuratora" : "Przejdź do profilu"}
          </Link>
        </p>
        <LogoutForm className={`button button--outline ${styles.submit}`}>Wyloguj</LogoutForm>
      </div>
    );
  }

  const email = loginEmailFromCookie((await cookies()).get(LOGIN_EMAIL_COOKIE)?.value);
  const [accounts, photo] = await Promise.all([
    entry === "login" ? listDemoAccounts() : Promise.resolve([]),
    loadAuthPhoto(),
  ]);
  const passwordError = passwordMessage(errorCode);
  const texts = ENTRY_TEXTS[entry];

  return (
    <div className="content-width-wide">
      <AuthTwoColumns photo={photo} sentence={texts.sentence}>
        <h1>{email === null ? texts.title : "Wpisz kod z wiadomości"}</h1>
        {email === null ? <p>{texts.intro}</p> : null}

        <section aria-label="Logowanie kodem z e-maila" className={styles.section}>
          <CodeForms
            entry={entry}
            returnTo={returnTo}
            email={email}
            codeSent={codeSent}
            codeInvalid={marksCodeInvalid(errorCode)}
            errorMessage={isCodeError(errorCode) ? codeMessage(errorCode) : undefined}
          />
        </section>

        {entry === "login" ? (
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
        ) : null}

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
      </AuthTwoColumns>
    </div>
  );
}
