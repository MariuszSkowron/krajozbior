import { REGIONS, REGION_LABELS } from "@/features/catalog/domain/collection";
import {
  FIRST_NAME_MAX_LENGTH,
  VISIBILITIES,
  type Profile,
  type ProfileField,
  type Visibility,
} from "@/features/profile/domain/profile";

import styles from "./settings.module.css";

// What a save result means for the person (the form posts natively and the route
// redirects back to the settings screen with `?profil=`).
const messages: Record<string, string> = {
  blad: "Nie zapisaliśmy profilu. Popraw zaznaczone pola i spróbuj jeszcze raz.",
  limit: "Za dużo zapisów w krótkim czasie. Spróbuj za chwilę.",
  niedostepny: "Nie udało się zapisać profilu. Spróbuj jeszcze raz za chwilę.",
};

const fieldMessages: Record<ProfileField, string> = {
  firstName:
    "Imię: wpisz do 40 liter (może mieć spację, myślnik lub apostrof). Pierwszą literę nazwiska podaj tylko razem z imieniem.",
  familyInitial: "Pierwsza litera nazwiska: wpisz jedną literę.",
  region: "Region: wybierz województwo z listy.",
  visibility: "Widoczność: wybierz jedną z opcji.",
};

const visibilityChoices: Record<Visibility, { label: string; hint: string }> = {
  private: {
    label: "Tylko ja",
    hint: "Nikt poza Tobą nie zobaczy Twojego imienia ani regionu.",
  },
  public: {
    label: "Inni odkrywcy",
    hint: "Gdy strona profilu dla innych odkrywców będzie gotowa, zobaczą na niej imię, region i liczby, nigdy historię wizyt. Na razie nikt poza Tobą nie widzi profilu.",
  },
};

const knownFields: readonly string[] = ["firstName", "familyInitial", "region", "visibility"];

function invalidFields(codes: string | undefined): ProfileField[] {
  return (codes ?? "")
    .split(",")
    .filter((code): code is ProfileField => knownFields.includes(code));
}

// E9-2: the "Profil" section of the settings. A native form: it works without
// JavaScript, the route decides everything and the body never names an owner.
export function ProfileForm({
  profile,
  result,
  fields,
}: {
  profile: Profile;
  result: string | undefined;
  fields: string | undefined;
}) {
  const wrong = result === "blad" ? invalidFields(fields) : [];
  const message = result === undefined ? undefined : messages[result];

  return (
    <section aria-labelledby="settings-profile" className={styles.section} id="profil">
      <h2 id="settings-profile">Profil</h2>

      {result === "zapisano" ? (
        <p role="status" className={styles.success}>
          Zapisano zmiany w profilu.
        </p>
      ) : null}
      {message === undefined ? null : (
        <div id="profile-error" role="alert" className={styles.error}>
          <p>
            <span className={styles.errorPrefix}>Błąd:</span> {message}
          </p>
          {wrong.length === 0 ? null : (
            <ul>
              {wrong.map((field) => (
                <li key={field}>{fieldMessages[field]}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form method="post" action="/api/me/profile" className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="profile-first-name">Imię</label>
          <input
            id="profile-first-name"
            name="firstName"
            type="text"
            maxLength={FIRST_NAME_MAX_LENGTH}
            autoComplete="given-name"
            defaultValue={profile.firstName ?? ""}
            aria-describedby="profile-first-name-hint"
            aria-invalid={wrong.includes("firstName") ? "true" : undefined}
          />
          <p id="profile-first-name-hint" className={styles.hint}>
            Bez imienia pokazujemy „Odkrywca”.
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="profile-family-initial">Pierwsza litera nazwiska</label>
          <input
            id="profile-family-initial"
            name="familyInitial"
            type="text"
            maxLength={1}
            autoComplete="off"
            defaultValue={profile.familyInitial ?? ""}
            aria-describedby="profile-family-initial-hint"
            aria-invalid={wrong.includes("familyInitial") ? "true" : undefined}
            className={styles.short}
          />
          <p id="profile-family-initial-hint" className={styles.hint}>
            Nieobowiązkowa. Z imienia i tej litery powstaje podpis, np. „Anna K.”. Całego nazwiska
            nie zapisujemy.
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor="profile-region">Region</label>
          <select
            id="profile-region"
            name="region"
            defaultValue={profile.region ?? ""}
            aria-invalid={wrong.includes("region") ? "true" : undefined}
          >
            <option value="">Nie podaję</option>
            {REGIONS.map((region) => (
              <option key={region} value={region}>
                {REGION_LABELS[region]}
              </option>
            ))}
          </select>
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Kto zobaczy Twój profil</legend>
          {VISIBILITIES.map((visibility) => (
            <div key={visibility} className={styles.choice}>
              <input
                id={`profile-visibility-${visibility}`}
                name="visibility"
                type="radio"
                value={visibility}
                defaultChecked={profile.visibility === visibility}
                aria-describedby={`profile-visibility-${visibility}-hint`}
              />
              <label htmlFor={`profile-visibility-${visibility}`}>
                {visibilityChoices[visibility].label}
              </label>
              <p id={`profile-visibility-${visibility}-hint`} className={styles.hint}>
                {visibilityChoices[visibility].hint}
              </p>
            </div>
          ))}
          <p className={styles.hint}>E-mail i ustawienia konta widzisz tylko Ty.</p>
        </fieldset>

        <button className="button button--primary" type="submit">
          Zapisz profil
        </button>
      </form>
    </section>
  );
}
