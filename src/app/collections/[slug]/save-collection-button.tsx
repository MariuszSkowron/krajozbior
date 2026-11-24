"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "@/app/my/collections/collections.module.css";
import { changeSavedCollection } from "@/app/saved-collection-request";
import { useHydrated } from "@/app/use-hydrated";

type Props = { collectionId: string; initialSaved: boolean };

// Saves or unsaves the collection through the album route (PUT / DELETE, same
// origin). The page is rendered on the server for the signed-in explorer; this
// button only changes the save and asks the server to render the page again.
export function SaveCollectionButton({ collectionId, initialSaved }: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);

  async function toggle() {
    setPending(true);
    setError(null);

    const change = await changeSavedCollection(collectionId, saved ? "DELETE" : "PUT");

    if (change.ok) {
      setSaved(!saved);
      setRemoved(saved);
      router.refresh();
    } else {
      setError(change.message);
    }

    setPending(false);
  }

  return (
    <div className={styles.guestAction}>
      <button
        type="button"
        className={saved ? "button button--outline" : "button button--primary"}
        disabled={pending || !hydrated}
        aria-busy={pending}
        onClick={() => void toggle()}
      >
        {saved ? "Usuń z zapisanych" : "Zapisuję kolekcję"}
        {pending ? <span className={styles.spinner} aria-hidden="true" /> : null}
      </button>
      <p className={styles.feedback} role="status">
        {pending
          ? "Zapisuję…"
          : (error ??
            (saved ? "Kolekcja jest zapisana." : removed ? "Usunięto z zapisanych." : ""))}
      </p>
    </div>
  );
}
