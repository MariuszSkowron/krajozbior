"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { PastVisitDateFields } from "@/app/past-visit-date-fields";
import pastStyles from "@/app/past-visit.module.css";
import { StatusBadge } from "@/design-system/components/status-badge";
import {
  EMPTY_PAST_VISIT_DATE,
  INCOMPLETE_DATE_MESSAGE,
  pastVisitFailureMessage,
  pastVisitSavedMessage,
  toPastVisitDateBody,
  type PastVisitDateForm,
} from "@/features/visits/domain/past-visit-form";
import { MAX_PAST_VISITS_PER_REQUEST } from "@/features/visits/domain/limits";

import styles from "../../catalog.module.css";

type Place = {
  id: string;
  name: string;
  address: string;
  position: number;
  /** The explorer's visit of the place: confirmed on site, from the past, or none. */
  kind: "on_site" | "past" | null;
};

// The places of a collection for a signed-in explorer (E2-S6, P3): a badge with
// the kind of the visit at every visited place, and "Zaznacz odwiedzone", which
// turns the list into a choice of places the explorer has not visited yet (a
// visited place has no checkbox: one visit per place). One date for all chosen
// places, up to 100 at a time (D-3). The page is rendered again after a save,
// so the progress above the list grows; the message stays here and gets the focus.
export function CollectionPlaces({ places }: { places: Place[] }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [form, setForm] = useState<PastVisitDateForm>(EMPTY_PAST_VISIT_DATE);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);

  const canPick = places.some((place) => place.kind === null);
  const full = chosen.length >= MAX_PAST_VISITS_PER_REQUEST;

  function finish(text: string, isFailure: boolean) {
    setMessage(text);
    setFailed(isFailure);
    setPending(false);
    queueMicrotask(() => status.current?.focus());
  }

  function toggle(placeId: string, checked: boolean) {
    setChosen((current) =>
      checked ? [...current, placeId] : current.filter((id) => id !== placeId),
    );
  }

  async function save() {
    const date = toPastVisitDateBody(form);

    if (chosen.length === 0) {
      finish("Zaznacz co najmniej jedno miejsce.", true);

      return;
    }

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
        body: JSON.stringify({ placeIds: chosen, date }),
      });

      if (response.status === 201) {
        const answer = (await response.json()) as { recorded: number; alreadyVisited: number };

        setPicking(false);
        setChosen([]);
        finish(pastVisitSavedMessage(answer.recorded, answer.alreadyVisited), false);
        router.refresh();
      } else {
        finish(pastVisitFailureMessage(response.status, true), true);
      }
    } catch {
      finish("Brak połączenia. Spróbuj ponownie.", true);
    }
  }

  return (
    <>
      <div className={pastStyles.toolbar}>
        {canPick ? (
          <button
            type="button"
            className="button button--outline"
            aria-expanded={picking}
            aria-controls="zaznacz-odwiedzone"
            disabled={pending}
            onClick={() => {
              setPicking(!picking);
              setMessage("");
            }}
          >
            {picking ? "Anuluj zaznaczanie" : "Zaznacz odwiedzone"}
          </button>
        ) : null}
        {picking ? (
          <form
            id="zaznacz-odwiedzone"
            className={pastStyles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className={pastStyles.note}>
              Zaznacz miejsca, w których już byłeś (do {MAX_PAST_VISITS_PER_REQUEST} naraz).
              Wybrane: {chosen.length}.
            </p>
            <PastVisitDateFields legend="Kiedy tam byłeś?" value={form} onChange={setForm} />
            <div className={pastStyles.actions}>
              <button
                type="submit"
                className="button button--primary"
                disabled={pending}
                aria-busy={pending}
              >
                Zapisz wizyty z przeszłości
              </button>
            </div>
          </form>
        ) : null}
        <p
          ref={status}
          tabIndex={-1}
          role={failed ? "alert" : "status"}
          className={`${pastStyles.note} ${failed ? pastStyles.danger : ""}`}
        >
          {message}
        </p>
      </div>
      <ol className={styles.list}>
        {places.map((place) => {
          const title = (
            <span className={styles.itemTitle}>
              <span className={styles.itemNumber}>{place.position}.</span> {place.name}
            </span>
          );

          return (
            <li key={place.id} className={styles.item}>
              {picking && place.kind === null ? (
                <label className={pastStyles.pickLabel}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(place.id)}
                    disabled={full && !chosen.includes(place.id)}
                    onChange={(event) => toggle(place.id, event.target.checked)}
                  />
                  <span>
                    {title}
                    {place.address === "" ? null : (
                      <span className={styles.itemMeta}> {place.address}</span>
                    )}
                  </span>
                </label>
              ) : (
                <Link className={styles.itemLink} href={`/places/${place.id}`}>
                  {title}
                  {place.address === "" ? null : (
                    <span className={styles.itemMeta}>{place.address}</span>
                  )}
                  {place.kind === null ? null : (
                    <span className={pastStyles.badgeRow}>
                      {place.kind === "on_site" ? (
                        <StatusBadge tone="success">Odwiedzone</StatusBadge>
                      ) : (
                        <StatusBadge tone="info">Z przeszłości</StatusBadge>
                      )}
                    </span>
                  )}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
