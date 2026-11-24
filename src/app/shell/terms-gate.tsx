import { AuthTwoColumns } from "@/app/auth-photo";
import type { HomeBannerPick } from "@/features/catalog/application/catalog-types";
import { safeReturnTo } from "@/features/identity/domain/return-to";
import { legalPage } from "@/features/legal/domain/legal-pages";
import { TERMS_DRAFT_DATE } from "@/features/terms/domain/terms-version";

import { LogoutForm } from "./logout-form";
import styles from "./terms-gate.module.css";
import { TermsForm } from "./terms-form";

// Komunikaty po odesłaniu z formularza akceptacji (parametr `zgoda` w adresie).
const PROBLEMS: Readonly<Record<string, string>> = {
  wymagana: "Zaznacz pole „Akceptuję Regulamin”.",
  niedostepny: "Nie udało się zapisać akceptacji. Spróbuj ponownie za chwilę.",
};

export function termsGateProblem(code: string | null): string | undefined {
  return code !== null && Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code] : undefined;
}

// Ekran „Zanim zaczniesz” (F-K3, E11-Q4 A): po zalogowaniu, gdy konto nie zaakceptowało
// bieżącej wersji regulaminu, zastępuje stronę. Konto widzi tylko ten ekran i wylogowanie;
// strony prawne dalej działają. O tym, kiedy ekran się pokazuje, decyduje TermsGuard
// (terms-guard.tsx), który podaje ścieżkę strony i kod problemu z parametru `zgoda`.
// Natywny formularz działa bez JavaScriptu. „Nie akceptuję” wylogowuje.
export function TermsGate({
  path,
  problemCode,
  photo = null,
  firstSignIn = false,
}: Readonly<{
  path: string;
  problemCode: string | null;
  /** Zdjęcie z puli banera do drugiej kolumny (komputer); bez niego tło zastępcze. */
  photo?: HomeBannerPick | null;
  /** Ktoś wybrał „Zaloguj się”, a konta z tym adresem nie było: wyjaśniamy, że je założyliśmy. */
  firstSignIn?: boolean;
}>) {
  const problem = termsGateProblem(problemCode);
  const links = (["regulamin", "polityka-prywatnosci", "zasady"] as const).map(legalPage);

  return (
    <div className="content-width-wide">
      <AuthTwoColumns photo={photo} sentence="Za chwilę zaczniesz zbierać miejsca w swoim albumie.">
        <TermsGateBody path={path} problem={problem} links={links} firstSignIn={firstSignIn} />
      </AuthTwoColumns>
    </div>
  );
}

function TermsGateBody({
  path,
  problem,
  links,
  firstSignIn,
}: Readonly<{
  path: string;
  problem: string | undefined;
  links: readonly ReturnType<typeof legalPage>[];
  firstSignIn: boolean;
}>) {
  return (
    <>
      <meta name="robots" content="noindex" />
      <h1>Zanim zaczniesz</h1>
      {firstSignIn ? (
        <p role="status" className={styles.notice}>
          To pierwsze logowanie tym adresem, więc zakładamy nowe konto. Masz już konto na inny
          adres? Wyloguj się i podaj tamten.
        </p>
      ) : null}
      <p>Żeby korzystać z konta, zaakceptuj regulamin. Najważniejsze zasady:</p>
      <ul className={styles.summary}>
        <li>Krajozbiór jest bezpłatny i nie ma w nim reklam.</li>
        <li>Nie zapisujemy Twojej lokalizacji; zapamiętujemy samą wizytę.</li>
        <li>Twoich wizyt nie pokazujemy innym.</li>
        <li>Konto możesz w każdej chwili usunąć w ustawieniach; dane znikają od razu.</li>
        <li>Logujesz się kodem z e-maila. Nikomu go nie przekazuj.</li>
      </ul>
      <p className={styles.links}>
        Pełne teksty:{" "}
        {links.map((link, index) => (
          <span key={link.slug}>
            {index === 0 ? "" : index === links.length - 1 ? " i " : ", "}
            <a href={link.path}>{link.title}</a>
          </span>
        ))}
        .
      </p>
      <TermsForm
        returnTo={safeReturnTo(path)}
        serverProblem={problem}
        termsDate={TERMS_DRAFT_DATE}
      />
      <LogoutForm className={`button button--outline ${styles.submit}`} reason="terms-declined">
        Nie akceptuję — wyloguj
      </LogoutForm>
    </>
  );
}
