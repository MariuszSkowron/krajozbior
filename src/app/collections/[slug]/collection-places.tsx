"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { PastVisitDateFields } from "@/app/past-visit-date-fields";
import { PastVisitMessage } from "@/app/past-visit-message";
import pastStyles from "@/app/past-visit.module.css";
import { StatusBadge } from "@/design-system/components/status-badge";
import {
  EMPTY_PAST_VISIT_DATE,
  INCOMPLETE_DATE_MESSAGE,
  pastVisitFailureMessage,
  pastVisitSavedMessage,
  pickedCountMessage,
  toPastVisitDateBody,
  type PastVisitDateForm,
} from "@/features/visits/domain/past-visit-form";
import { MAX_PAST_VISITS_PER_REQUEST } from "@/features/visits/domain/limits";

import styles from "../../catalog.module.css";
import albumStyles from "./album.module.css";

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
  const statusRef = useRef<HTMLParagraphElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const canPick = places.some((place) => place.kind === null);
  const full = chosen.length >= MAX_PAST_VISITS_PER_REQUEST;

  function finish(text: string, isFailure: boolean) {
    setMessage(text);
    setFailed(isFailure);
    setPending(false);
    // Both regions are in the page all the time, so the focus does not have to wait
    // for the render that puts the text in (it comes after this microtask).
    queueMicrotask(() => (isFailure ? alertRef : statusRef).current?.focus());
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
            aria-controls={picking ? "zaznacz-odwiedzone" : undefined}
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
            // See the form of the place page: the form checks the chosen field itself.
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className={pastStyles.note}>
              Zaznacz miejsca odwiedzone wcześniej (do {MAX_PAST_VISITS_PER_REQUEST} naraz), a potem
              zapisz je przyciskiem pod listą.
            </p>
            <p className={pastStyles.note} aria-live="polite" aria-atomic="true">
              {pickedCountMessage(chosen.length, MAX_PAST_VISITS_PER_REQUEST)}
            </p>
            <PastVisitDateFields legend="Kiedy to było?" value={form} onChange={setForm} />
          </form>
        ) : null}
        <PastVisitMessage
          message={message}
          failed={failed}
          statusRef={statusRef}
          alertRef={alertRef}
        />
      </div>
      <ol className={albumStyles.grid}>
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
      {picking ? (
        // Under the list, so that the keyboard reaches the checkboxes before the button;
        // `form` joins it to the form above (date and Enter in a date field work as before).
        <div className={pastStyles.listActions}>
          <button
            type="submit"
            form="zaznacz-odwiedzone"
            className="button button--primary"
            disabled={pending}
            aria-busy={pending}
          >
            Zapisz wizyty z przeszłości
          </button>
        </div>
      ) : null}
    </>
  );
}
