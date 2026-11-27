"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { changeSavedCollection } from "@/app/saved-collection-request";
import { useHydrated } from "@/app/use-hydrated";

import styles from "./home-sections.module.css";

// „Zapisuję kolekcję” na Starcie (napis jak na stronie kolekcji, D-49 pkt 8, D-55 pkt 3): ten sam zapis co na stronie kolekcji (wspólne wywołanie trasy
// albumu i wspólne komunikaty). Po zapisie strona odświeża się, a zachęta znika, bo kolekcja jest
// już zapisana.
export function SaveNudgeButton({ collectionId }: Readonly<{ collectionId: string }>) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);

    const change = await changeSavedCollection(collectionId, "PUT");

    if (change.ok) {
      router.refresh();
    } else {
      setError(change.message);
    }

    setPending(false);
  }

  return (
    <>
      <button
        type="button"
        className="button button--primary"
        disabled={pending || !hydrated}
        aria-busy={pending}
        onClick={() => void save()}
      >
        Zapisuję kolekcję
      </button>
      <p className={styles.nudgeStatus} role="status">
        {pending ? "Zapisuję…" : (error ?? "")}
      </p>
    </>
  );
}
