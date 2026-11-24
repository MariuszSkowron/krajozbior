"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_COLLECTIONS_PER_LIST } from "@/features/catalog/domain/limits";

import styles from "./home-sections.module.css";

const MESSAGES: Record<number, string> = {
  401: "Zaloguj się, żeby zapisać kolekcję.",
  404: "Ta kolekcja nie jest już dostępna.",
  409: `Masz już ${MAX_COLLECTIONS_PER_LIST} zapisanych kolekcji, to najwięcej. Usuń którąś, by zapisać nową.`,
  429: "Za dużo prób. Spróbuj za chwilę.",
};

// „Zapisz kolekcję” na Starcie: ten sam zapis co na stronie kolekcji (PUT przez trasę albumu,
// to samo źródło). Po zapisie strona odświeża się, a zachęta znika, bo kolekcja jest już zapisana.
export function SaveNudgeButton({ collectionId }: Readonly<{ collectionId: string }>) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/me/saved-collections/${collectionId}`, { method: "PUT" });

      if (response.ok) {
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
    <>
      <button
        type="button"
        className="button button--primary"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void save()}
      >
        Zapisz kolekcję
      </button>
      <p className={styles.nudgeStatus} role="status">
        {pending ? "Zapisuję…" : (error ?? "")}
      </p>
    </>
  );
}
