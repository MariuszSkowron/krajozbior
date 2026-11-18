"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { PastVisitDateFields } from "@/app/past-visit-date-fields";
import styles from "@/app/past-visit.module.css";
import { StatusBadge } from "@/design-system/components/status-badge";
import {
  EMPTY_PAST_VISIT_DATE,
  INCOMPLETE_DATE_MESSAGE,
  pastVisitFailureMessage,
  pastVisitRemovalFailureMessage,
  pastVisitSavedMessage,
  toPastVisitDateBody,
  type PastVisitDateForm,
} from "@/features/visits/domain/past-visit-form";

// `existing` is the text of the explorer's visit from the past ("Z przeszłości ·
// marzec 2019"), or null when there is none.
type Props = { placeId: string; existing: string | null };

// "Byłem tu wcześniej" (E2-S6): the secondary action of the place page, in the
// content, never in the pinned bar (spec decision P5). One visit from the past
// per place: while there is one, the box shows it with the button that takes it
// back (only a visit from the past; a visit confirmed on site is never touched).
// The page is rendered again after a change (`router.refresh()`); the message
// stays in this component and gets the focus, because the button that had it
// disappears.
export function PastVisit({ placeId, existing }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PastVisitDateForm>(EMPTY_PAST_VISIT_DATE);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);

  function finish(text: string, isFailure: boolean) {
    setMessage(text);
    setFailed(isFailure);
    setPending(false);
    // The message is rendered in this commit; focus it after React has put the text in.
    queueMicrotask(() => status.current?.focus());
  }

  async function save() {
    const date = toPastVisitDateBody(form);

    if (date === null) {
      finish(INCOMPLETE_DATE_MESSAGE, true);

      return;
    }

    setPending(true);
    setMessage("");

    try {
      const response = await fetch("/api/me/visits/past", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeIds: [placeId], date }),
      });

      if (response.status === 201) {
        const answer = (await response.json()) as { recorded: number; alreadyVisited: number };

        setOpen(false);
        finish(pastVisitSavedMessage(answer.recorded, answer.alreadyVisited), false);
        router.refresh();
      } else {
        finish(pastVisitFailureMessage(response.status, false), true);
      }
    } catch {
      finish("Brak połączenia. Spróbuj ponownie.", true);
    }
  }

  async function remove() {
    setPending(true);
    setMessage("");

    try {
      const response = await fetch(`/api/me/visits/past/${placeId}`, { method: "DELETE" });

      if (response.status === 204) {
        finish("Usunięto wizytę z przeszłości.", false);
        router.refresh();
      } else {
        finish(pastVisitRemovalFailureMessage(response.status), true);
      }
    } catch {
      finish("Brak połączenia. Spróbuj ponownie.", true);
    }
  }

  return (
    <div className={styles.secondary}>
      {existing === null ? (
        <>
          <button
            type="button"
            className="button button--outline"
            aria-expanded={open}
            aria-controls="wizyta-z-przeszlosci"
            disabled={pending}
            onClick={() => setOpen(!open)}
          >
            Byłem tu wcześniej
          </button>
          {open ? (
            <form
              id="wizyta-z-przeszlosci"
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <PastVisitDateFields
                legend="Kiedy tu byłeś?"
                value={form}
                onChange={setForm}
                focusFirst
              />
              <div className={styles.actions}>
                <button
                  type="submit"
                  className="button button--primary"
                  disabled={pending}
                  aria-busy={pending}
                >
                  Zapisz wizytę z przeszłości
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : (
        <>
          <p className={styles.badgeRow}>
            <StatusBadge tone="info">{existing}</StatusBadge>
          </p>
          <button
            type="button"
            className="button button--outline"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void remove()}
          >
            Usuń wizytę z przeszłości
          </button>
        </>
      )}
      <p
        ref={status}
        tabIndex={-1}
        role={failed ? "alert" : "status"}
        className={`${styles.note} ${failed ? styles.danger : ""}`}
      >
        {message}
      </p>
    </div>
  );
}
