import Form from "next/form";

import { REGIONS, REGION_LABELS, type Region } from "@/features/catalog/domain/collection";
import { SEARCH_MAX_LENGTH } from "@/features/catalog/domain/search";

import styles from "./search.module.css";

// Wyszukiwarka jako zwykły formularz GET (D-E12-4): z JavaScriptem nawigacja po stronie klienta,
// bez niego zwykłe przejście na `/search?q=…`. Pole ma widoczną etykietę; formularz to obszar
// wyszukiwania (`role="search"`). Strona główna pokazuje samo pole, `/search` także województwo.
export function SearchForm({
  id,
  phrase = "",
  region = null,
  withRegion = false,
}: Readonly<{
  /** Prefiks identyfikatorów pól: na stronie jest jeden formularz, ale id musi być unikalne. */
  id: string;
  phrase?: string;
  region?: Region | null;
  withRegion?: boolean;
}>) {
  return (
    <Form
      action="/search"
      role="search"
      aria-label="Wyszukiwarka miejsc i kolekcji"
      className={styles.form}
    >
      <div className={styles.field}>
        <label htmlFor={`${id}-q`}>Szukaj miejsc i kolekcji</label>
        <input
          id={`${id}-q`}
          name="q"
          type="search"
          defaultValue={phrase}
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          placeholder="np. wieża, Gniew, pomorskie"
        />
      </div>
      {withRegion ? (
        <div className={styles.field}>
          <label htmlFor={`${id}-region`}>Województwo</label>
          <select id={`${id}-region`} name="region" defaultValue={region ?? ""}>
            <option value="">Wszystkie województwa</option>
            {REGIONS.map((code) => (
              <option key={code} value={code}>
                {REGION_LABELS[code]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <button type="submit" className="button button--primary">
        Szukaj
      </button>
    </Form>
  );
}
