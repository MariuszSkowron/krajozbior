"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { callOwnApi, type OwnApiResult } from "./own-api";
import styles from "./own.module.css";

// Small buttons of the page of an own collection. Each one sends one request and refreshes the
// page; the answer is announced in a polite live region next to the button (`role="status"`),
// an error in `role="alert"`. Native buttons only.

function useAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run<T>(
    send: () => Promise<OwnApiResult<T>>,
    successText: string,
    after?: () => void,
  ) {
    if (pending) {
      return;
    }

    setPending(true);
    setMessage(null);

    const result = await send();

    setPending(false);

    if (result.ok) {
      setMessage({ kind: "ok", text: successText });
      if (after === undefined) {
        router.refresh();
      } else {
        after();
      }
    } else {
      setMessage({ kind: "error", text: result.failure.message });
    }
  }

  return { pending, message, run };
}

function Message({
  message,
}: Readonly<{ message: { kind: "ok" | "error"; text: string } | null }>) {
  return (
    <>
      <span role="status" className={styles.statusText}>
        {message?.kind === "ok" ? message.text : ""}
      </span>
      {message?.kind === "error" ? (
        <span role="alert" className={styles.errorText}>
          Błąd: {message.text}
        </span>
      ) : null}
    </>
  );
}

/** "Dodaj" at a hit of the place search. */
export function AddPlaceButton({
  collectionId,
  placeId,
  placeName,
  alreadyThere,
}: Readonly<{ collectionId: string; placeId: string; placeName: string; alreadyThere: boolean }>) {
  const { pending, message, run } = useAction();

  if (alreadyThere) {
    return <span className={styles.statusText}>Już w kolekcji</span>;
  }

  return (
    <span className={styles.rowAction}>
      <button
        type="button"
        className="button button--outline"
        aria-disabled={pending}
        aria-label={`Dodaj do kolekcji: ${placeName}`}
        onClick={() =>
          void run(
            () => callOwnApi("POST", `/api/me/own-collections/${collectionId}/items`, { placeId }),
            "Dodano do kolekcji.",
          )
        }
      >
        {pending ? "Dodawanie…" : "Dodaj"}
      </button>
      <Message message={message} />
    </span>
  );
}

/** "Usuń z kolekcji" at an entry (also the one of a place the curator deleted). */
export function RemoveEntryButton({
  collectionId,
  entryId,
  label,
}: Readonly<{ collectionId: string; entryId: string; label: string }>) {
  const { pending, message, run } = useAction();

  return (
    <span className={styles.rowAction}>
      <button
        type="button"
        className="button button--outline"
        aria-disabled={pending}
        aria-label={`Usuń z kolekcji: ${label}`}
        onClick={() =>
          void run(
            () =>
              callOwnApi("DELETE", `/api/me/own-collections/${collectionId}/items`, {
                itemId: entryId,
              }),
            "Usunięto z kolekcji.",
          )
        }
      >
        {pending ? "Usuwanie…" : "Usuń z kolekcji"}
      </button>
      <Message message={message} />
    </span>
  );
}

/** Deleting the whole collection, after a second click that confirms it. */
export function DeleteCollectionButton({ collectionId }: Readonly<{ collectionId: string }>) {
  const router = useRouter();
  const { pending, message, run } = useAction();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="button button--outline" onClick={() => setConfirming(true)}>
        Usuń kolekcję
      </button>
    );
  }

  return (
    <div className={styles.confirm} role="group" aria-label="Potwierdź usunięcie kolekcji">
      <p>Usunąć tę kolekcję razem z wpisami? Tego nie da się cofnąć.</p>
      <div className={styles.confirmButtons}>
        <button
          type="button"
          className="button button--primary"
          aria-disabled={pending}
          onClick={() =>
            void run(
              () => callOwnApi("DELETE", `/api/me/own-collections/${collectionId}`),
              "Usunięto kolekcję.",
              () => router.push("/my/collections"),
            )
          }
        >
          {pending ? "Usuwanie…" : "Tak, usuń kolekcję"}
        </button>
        <button
          type="button"
          className="button button--outline"
          onClick={() => setConfirming(false)}
        >
          Anuluj
        </button>
      </div>
      <Message message={message} />
    </div>
  );
}
