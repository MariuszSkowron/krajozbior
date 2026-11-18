"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { callApi } from "./curator-api";
import { failed, FeedbackRegion, type Feedback } from "./curator-ui";
import styles from "./curator.module.css";

type PublicationControlsProps = Readonly<{
  collection: Readonly<{
    id: string;
    title: string;
    version: number;
    status: "draft" | "published";
    /** True when the collection was ever published: it can then never be deleted (D-15). */
    wasPublished: boolean;
  }>;
}>;

// Publish, withdraw and delete (only a draft never published). Withdrawing
// keeps the saves and visits of explorers; they come back on the next
// publication. The rules are the server's: this only sends the request and
// tells the answer.
export function PublicationControls({ collection }: PublicationControlsProps) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const canDelete = collection.status === "draft" && !collection.wasPublished;

  async function change(path: "publish" | "unpublish", doneMessage: string) {
    if (pending) {
      return;
    }

    setPending(true);

    const result = await callApi(
      "POST",
      `/api/curator/collections/${collection.id}/${path}`,
      "collection",
      { version: collection.version },
    );

    setPending(false);

    if (result.ok) {
      setFeedback({ kind: "success", message: doneMessage });
      router.refresh();
    } else {
      setFeedback(failed(result.failure));
    }
  }

  async function remove() {
    if (pending) {
      return;
    }

    setPending(true);

    const result = await callApi(
      "DELETE",
      `/api/curator/collections/${collection.id}`,
      "collection",
    );

    if (result.ok) {
      router.push("/curator");

      return;
    }

    dialogRef.current?.close();
    setPending(false);
    setFeedback(failed(result.failure));
  }

  return (
    <section aria-labelledby="publication-heading" className={styles.section}>
      <h2 id="publication-heading">Publikacja</h2>
      {collection.status === "draft" ? (
        <p>
          Szkic widzisz tylko Ty i zespół organizacji. Po publikacji kolekcję zobaczą wszyscy.
          Publikacja wymaga co najmniej jednego miejsca.
        </p>
      ) : (
        <p>
          Kolekcja jest opublikowana. Po wycofaniu publikacji znika z katalogu, ale zapisy i wizyty
          odkrywców zostają i wracają po ponownej publikacji.
        </p>
      )}
      <FeedbackRegion
        feedback={feedback}
        onReload={() => {
          setFeedback({ kind: "info", message: "Wczytano aktualny stan kolekcji." });
          router.refresh();
        }}
      />
      <div className={styles.actions}>
        {collection.status === "draft" ? (
          <button
            type="button"
            className={`button button--primary ${styles.pending}`}
            aria-disabled={pending}
            onClick={() => change("publish", "Kolekcja jest opublikowana.")}
          >
            Publikuj
          </button>
        ) : (
          <button
            type="button"
            className={`button button--outline ${styles.pending}`}
            aria-disabled={pending}
            onClick={() => change("unpublish", "Publikacja wycofana. Kolekcja wróciła do szkiców.")}
          >
            Wycofaj publikację
          </button>
        )}
        {canDelete ? (
          <button
            type="button"
            className="button button--danger"
            onClick={() => dialogRef.current?.showModal()}
          >
            Usuń szkic
          </button>
        ) : null}
      </div>
      {canDelete ? (
        <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="delete-heading">
          <h2 id="delete-heading">Usunąć ten szkic?</h2>
          <p>
            Szkic „{collection.title}” zniknie razem z listą jego miejsc. Tej operacji nie można
            cofnąć. Same miejsca zostają w organizacji.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={`button button--danger ${styles.pending}`}
              aria-disabled={pending}
              onClick={remove}
            >
              Usuń szkic
            </button>
            <button
              type="button"
              className="button button--outline"
              onClick={() => dialogRef.current?.close()}
            >
              Anuluj
            </button>
          </div>
        </dialog>
      ) : null}
    </section>
  );
}
