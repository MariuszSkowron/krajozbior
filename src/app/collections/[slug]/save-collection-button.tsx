"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "@/app/my/collections/collections.module.css";

type Props = { collectionId: string; initialSaved: boolean };

const MESSAGES: Record<number, string> = {
  401: "Sesja wygasła. Zaloguj się ponownie.",
  404: "Ta kolekcja nie jest już dostępna.",
  429: "Za dużo prób. Spróbuj za chwilę.",
};

// Saves or unsaves the collection through the album route (PUT / DELETE, same
// origin). The page is rendered on the server for the signed-in explorer; this
// button only changes the save and asks the server to render the page again.
export function SaveCollectionButton({ collectionId, initialSaved }: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  async function toggle() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/me/saved-collections/${collectionId}`, {
        method: saved ? "DELETE" : "PUT",
      });

      if (response.ok) {
        setSaved(!saved);
        setRemoved(saved);
        router.refresh();
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
    <div>
      <button
        type="button"
        className={saved ? `${styles.action} ${styles.secondary}` : styles.action}
        disabled={pending}
        onClick={() => void toggle()}
      >
        {saved ? "Usuń z zapisanych" : "Zapisz kolekcję"}
      </button>
      <p className={styles.feedback} role="status">
        {error ??
          (saved
            ? "Ta kolekcja jest w Twoich zapisanych."
            : removed
              ? "Usunięto z zapisanych."
              : "")}
      </p>
    </div>
  );
}
