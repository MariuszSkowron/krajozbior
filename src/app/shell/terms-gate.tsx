import { ErrorIcon } from "@/design-system/patterns/error-icon";
import { safeReturnTo } from "@/features/identity/domain/return-to";
import { legalPage } from "@/features/legal/domain/legal-pages";
import { TERMS_DRAFT_DATE } from "@/features/terms/domain/terms-version";

import { LogoutForm } from "./logout-form";
import styles from "./terms-gate.module.css";

// Komunikaty po odesłaniu z formularza akceptacji (parametr `zgoda` w adresie).
const PROBLEMS: Readonly<Record<string, string>> = {
  wymagana: "Zaznacz pole „Akceptuję Regulamin”, żeby przejść dalej.",
  niedostepny: "Nie udało się zapisać akceptacji. Spróbuj ponownie za chwilę.",
};

export function termsGateProblem(code: string | null): string | undefined {
  return code !== null && Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code] : undefined;
}

// Ekran „Zanim zaczniesz” (F-K3, E11-Q4 A): po zalogowaniu, gdy konto nie zaakceptowało
// bieżącej wersji regulaminu, zastępuje stronę. Konto widzi tylko ten ekran i wylogowanie;
// strony prawne dalej działają (otwierane zwykłymi odnośnikami, żeby powłoka narysowała się
// od nowa). Natywny formularz działa bez JavaScriptu. „Nie akceptuję” wylogowuje.
export function TermsGate({ url }: Readonly<{ url: string }>) {
  const [path = "/", query = ""] = url.split("?");
  const problem = termsGateProblem(new URLSearchParams(query).get("zgoda"));
  const links = (["regulamin", "polityka-prywatnosci", "zasady"] as const).map(legalPage);

  return (
    <div className={`content-width ${styles.page}`}>
      <meta name="robots" content="noindex" />
      <h1>Zanim zaczniesz</h1>
      <p>
        Żeby korzystać z konta, zapoznaj się z zasadami serwisu i zaakceptuj regulamin. Oto
        najważniejsze z nich:
      </p>
      <ul className={styles.summary}>
        <li>Krajozbiór jest bezpłatny i nie ma w nim reklam.</li>
        <li>Nie zapisujemy Twojej lokalizacji; zapamiętujemy samą wizytę.</li>
        <li>Twoich wizyt nie pokazujemy innym.</li>
        <li>Konto możesz w każdej chwili usunąć w ustawieniach; dane znikają od razu.</li>
        <li>Logujesz się kodem z e-maila. Nikomu go nie przekazuj.</li>
      </ul>
      <p>
        Pełne teksty:{" "}
        {links.map((link, index) => (
          <span key={link.slug}>
            {index === 0 ? "" : index === links.length - 1 ? " i " : ", "}
            <a href={link.path}>{link.title}</a>
          </span>
        ))}
        .
      </p>
      {problem === undefined ? null : (
        <p role="alert" className={styles.error}>
          <span className={styles.errorPrefix}>
            <ErrorIcon />
            Błąd:{" "}
          </span>
          {problem}
        </p>
      )}
      <form method="post" action="/api/me/terms-acceptance" className={styles.form}>
        <input type="hidden" name="returnTo" value={safeReturnTo(path)} />
        <label className={styles.check}>
          <input type="checkbox" name="accepted" required />
          <span>
            Akceptuję Regulamin (wersja robocza z dnia {TERMS_DRAFT_DATE}) i zapoznałem się /
            zapoznałam się z Polityką prywatności.
          </span>
        </label>
        <button type="submit" className={`button button--primary ${styles.submit}`}>
          Akceptuję
        </button>
      </form>
      <LogoutForm className={`button button--outline ${styles.submit}`} reason="terms-declined">
        Nie akceptuję — wyloguj
      </LogoutForm>
    </div>
  );
}
