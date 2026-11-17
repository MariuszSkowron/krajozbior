"use client";

import { useState } from "react";

import styles from "./visit-confirmation.module.css";

type Props = { placeId: string; initialWanted: boolean };

const MESSAGES: Record<number, string> = {
  401: "Sesja wygasła. Zaloguj się ponownie.",
  404: "To miejsce nie jest już dostępne.",
  429: "Za dużo prób. Spróbuj za chwilę.",
};

// Adds the place to the "Chcę zobaczyć" list or removes it through the route
// (PUT / DELETE, same origin). It sits in the box of the visit button, so it is
// also there under the message "poza promieniem" (spec R-02). The list is
// idempotent, so a repeated click never fails.
export function WantToSeeButton({ placeId, initialWanted }: Props) {
  const [wanted, setWanted] = useState(initialWanted);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  async function toggle() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/me/want-to-see/${placeId}`, {
        method: wanted ? "DELETE" : "PUT",
      });

      if (response.ok) {
        setWanted(!wanted);
        setRemoved(wanted);
      } else {
        setError(MESSAGES[response.status] ?? "Nie udało się zapisać zmiany. Spróbuj ponownie.");
      }
    } catch {
      setError("Brak połączenia. Spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.wantToSee}>
      <button
        type="button"
        className={styles.secondary}
        disabled={pending}
        aria-busy={pending}
        onClick={() => void toggle()}
      >
        {wanted ? "Usuń z Chcę zobaczyć" : "Chcę zobaczyć"}
      </button>
      <p className={styles.feedback} role={error === null ? "status" : "alert"}>
        {error ??
          (wanted
            ? "To miejsce jest na Twojej liście „Chcę zobaczyć”."
            : removed
              ? "Usunięto z listy „Chcę zobaczyć”."
              : "")}
      </p>
    </div>
  );
}
