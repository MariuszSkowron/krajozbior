"use client";

import { useRef, useState } from "react";

import { StatusBadge } from "@/design-system/components/status-badge";
import { formatProgress, type Progress } from "@/features/album/domain/progress";
import {
  geolocationProblemMessage,
  visitOutcomeMessage,
  type GeolocationProblem,
} from "@/features/visits/domain/visit-outcome";

import { PastVisit } from "./past-visit";
import { PinnedAction } from "./pinned-action";
import styles from "./visit-confirmation.module.css";
import { WantToSeeButton } from "./want-to-see-button";

// initialWanted is null when the list could not be read: only its button is hidden.
// past is the text of the explorer's visit from the past ("Z przeszłości · marzec 2019"), or null.
type Props = { placeId: string; initialWanted: boolean | null; past?: string | null };

type Reading = { latitude: number; longitude: number; accuracy: number };
type Attempt = { clientVisitId: string; reading: Reading };

type Collection = { slug: string; title: string; progress: Progress };

type State =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "sending" }
  | { kind: "recorded"; collections: Collection[] }
  | { kind: "out_of_range"; distanceM: number }
  | { kind: "inaccurate"; accuracyM: number }
  | { kind: "problem"; problem: GeolocationProblem }
  | { kind: "failed"; message: string; canRetry: boolean };

const FAILURES: Record<number, string> = {
  400: "Nie udało się odczytać lokalizacji. Spróbuj ponownie.",
  401: "Zaloguj się, żeby potwierdzić wizytę.",
  404: "To miejsce nie jest już dostępne.",
  429: "Za dużo prób. Spróbuj za chwilę.",
};

function problemOf(error: GeolocationPositionError): GeolocationProblem {
  // 1 = PERMISSION_DENIED, 3 = TIMEOUT; anything else: no position available.
  return error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
}

function readPosition(): Promise<Reading> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

// The button with the focus disappears after a saved visit; the focus moves to
// the success message, so that a screen reader reads it and the keyboard user
// does not fall back to the top of the page (docs/design/accessibility.md).
function focusOnMount(element: HTMLElement | null): void {
  element?.focus();
}

function feedbackText(state: State): string {
  switch (state.kind) {
    case "locating":
      return "Ustalam Twoje położenie…";
    case "sending":
      return "Sprawdzam odległość od miejsca…";
    case "out_of_range":
      return visitOutcomeMessage({ result: "out_of_range", distanceM: state.distanceM });
    case "inaccurate":
      return visitOutcomeMessage({ result: "inaccurate", accuracyM: state.accuracyM });
    case "problem":
      return geolocationProblemMessage(state.problem);
    case "failed":
      return state.message;
    default:
      return "";
  }
}

// "Potwierdź wizytę" of an explorer (E2-S2, E2-S3). The browser gives the
// reading; the server (the database) alone decides about distance and accuracy.
// The reading lives only in memory of this component for the one request: it is
// never stored, logged or shown. A retry after a lost answer (network error,
// server error) sends the same client visit id and the same body, so the
// server records one visit at most; a fresh check ("Sprawdź ponownie") reads
// the position again and uses a new id.
export function VisitConfirmation({ placeId, initialWanted, past = null }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const attempt = useRef<Attempt | null>(null);

  async function send(current: Attempt) {
    setState({ kind: "sending" });

    try {
      const response = await fetch(`/api/places/${placeId}/visits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...current.reading, clientVisitId: current.clientVisitId }),
      });

      if (response.status === 200 || response.status === 201) {
        const answer = (await response.json()) as
          | { result: "recorded"; collections: Collection[] }
          | { result: "out_of_range"; distanceM: number }
          | { result: "inaccurate"; accuracyM: number };

        attempt.current = null;

        if (answer.result === "recorded") {
          // No page refresh here: the page would replace this box with its
          // "already visited" note and the progress would vanish.
          setState({ kind: "recorded", collections: answer.collections });
        } else {
          setState(
            answer.result === "out_of_range"
              ? { kind: "out_of_range", distanceM: answer.distanceM }
              : { kind: "inaccurate", accuracyM: answer.accuracyM },
          );
        }

        return;
      }

      const known = FAILURES[response.status];

      if (known !== undefined) {
        attempt.current = null;
      }
      setState({
        kind: "failed",
        message: known ?? "Nie udało się zapisać wizyty. Spróbuj ponownie.",
        canRetry: known === undefined || response.status === 429,
      });
    } catch {
      setState({
        kind: "failed",
        message: "Brak połączenia. Spróbuj ponownie.",
        canRetry: true,
      });
    }
  }

  async function check() {
    attempt.current = null;

    if (!("geolocation" in navigator)) {
      setState({ kind: "problem", problem: "unsupported" });

      return;
    }

    setState({ kind: "locating" });

    let reading: Reading;

    try {
      reading = await readPosition();
    } catch (error) {
      setState({ kind: "problem", problem: problemOf(error as GeolocationPositionError) });

      return;
    }

    attempt.current = { clientVisitId: crypto.randomUUID(), reading };
    await send(attempt.current);
  }

  // The same id and the same reading as the lost attempt (the answer may have been lost, not the visit).
  const retry = () => (attempt.current === null ? check() : send(attempt.current));

  const busy = state.kind === "locating" || state.kind === "sending";

  if (state.kind === "recorded") {
    return (
      <div className={styles.box}>
        <p className={styles.success} role="status" tabIndex={-1} ref={focusOnMount}>
          Wizyta potwierdzona.
        </p>
        {state.collections.length === 0 ? null : (
          <ul className={styles.progress} aria-label="Twój postęp po tej wizycie">
            {state.collections.map((collection) => (
              <li key={collection.slug}>
                <span>{collection.title}</span>{" "}
                <strong>{formatProgress(collection.progress)}</strong>
              </li>
            ))}
          </ul>
        )}
        {/* Przypięty stan „Odwiedzone” (telefon); na komputerze `order` stawia go na górze karty. */}
        <PinnedAction>
          <p className={styles.visitedMark}>
            <StatusBadge tone="success">Odwiedzone</StatusBadge>
          </p>
        </PinnedAction>
      </div>
    );
  }

  const lost = state.kind === "failed" && state.canRetry;
  const label = lost
    ? "Spróbuj ponownie"
    : state.kind === "out_of_range" || state.kind === "inaccurate" || state.kind === "problem"
      ? "Sprawdź ponownie"
      : "Potwierdź wizytę";

  return (
    <div className={styles.box}>
      <PinnedAction>
        <button
          type="button"
          className={`button button--primary ${styles.action}`}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void (lost ? retry() : check())}
        >
          {label}
        </button>
        <p
          className={`${styles.feedback} ${
            state.kind === "failed" || state.kind === "problem"
              ? styles.feedbackDanger
              : state.kind === "out_of_range" || state.kind === "inaccurate"
                ? styles.feedbackWarning
                : ""
          }`}
          role={state.kind === "failed" || state.kind === "problem" ? "alert" : "status"}
        >
          {feedbackText(state)}
        </p>
      </PinnedAction>
      {state.kind === "idle" ? (
        <p className={styles.hint}>
          {past === null
            ? "Przeglądarka zapyta o zgodę na lokalizację. Nie zapisujemy, gdzie jesteś: tylko to, że byłeś w tym miejscu."
            : "Potwierdź na miejscu, gdy tu będziesz. Przeglądarka zapyta o zgodę na lokalizację; nie zapisujemy, gdzie jesteś."}
        </p>
      ) : null}
      {/* Drugorzędne akcje zostają w treści, nie w przypiętym pasku: „Byłem tu wcześniej”
          (wizyta z przeszłości, decyzja P5) i „Chcę zobaczyć”. */}
      <PastVisit placeId={placeId} existing={past} />
      {initialWanted === null ? (
        <p className={styles.feedback}>Lista „Chcę zobaczyć” jest chwilowo niedostępna.</p>
      ) : (
        <WantToSeeButton placeId={placeId} initialWanted={initialWanted} />
      )}
    </div>
  );
}
