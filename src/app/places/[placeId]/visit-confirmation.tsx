"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { VisitMark } from "@/design-system/components/visit-mark";
import { remainingInCollectionText, visitRecordedText } from "@/features/album/domain/next-place";
import { progressCounts, type Progress } from "@/features/album/domain/progress";
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
// radiusM is the public radius of the place: the message "za daleko" says how close to come.
// visited: the page already knows about a visit on site (after a reload or the refresh that follows
// a saved visit); the component then keeps showing the message and "co dalej" it started with.
// summary: the explorer's progress in the collections of the place, with the next place of each
// (read by the server after the visit). showPastMark is false when the mark stands above the photo.
type Props = {
  placeId: string;
  initialWanted: boolean | null;
  past?: string | null;
  radiusM?: number;
  visited?: boolean;
  placeName?: string;
  summary?: readonly AfterVisit[];
  showPastMark?: boolean;
};

export type AfterVisit = Readonly<{
  slug: string;
  title: string;
  visited: number;
  total: number;
  next: Readonly<{ id: string; name: string }> | null;
}>;

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

// States whose message is scrolled into view (a result the person has to see).
const SCROLLED_KINDS: ReadonlySet<State["kind"]> = new Set([
  "out_of_range",
  "inaccurate",
  "problem",
  "failed",
]);

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

function feedbackText(state: State, radiusM: number | undefined): string {
  switch (state.kind) {
    case "locating":
      return "Ustalam Twoje położenie…";
    case "sending":
      return "Sprawdzam odległość od miejsca…";
    case "out_of_range":
      return visitOutcomeMessage({ result: "out_of_range", distanceM: state.distanceM }, radiusM);
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

// "Potwierdzam wizytę" of an explorer (E2-S2, E2-S3). The browser gives the
// reading; the server (the database) alone decides about distance and accuracy.
// The reading lives only in memory of this component for the one request: it is
// never stored, logged or shown. A retry after a lost answer (network error,
// server error) sends the same client visit id and the same body, so the
// server records one visit at most; a fresh check ("Sprawdź ponownie") reads
// the position again and uses a new id.
export function VisitConfirmation({
  placeId,
  initialWanted,
  past = null,
  radiusM,
  visited = false,
  placeName,
  summary = [],
  showPastMark = true,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const [seenPast, setSeenPast] = useState(past);
  // The state of "Chcę zobaczyć" changed in this session: the page still has the old one until it
  // is read again, so the button (and its message) must not vanish and come back after the visit.
  const [wantedNow, setWantedNow] = useState<boolean | null>(initialWanted);
  const [wantedEver, setWantedEver] = useState(initialWanted === true);
  const onWantedChange = (wanted: boolean) => {
    setWantedNow(wanted);
    setWantedEver((ever) => ever || wanted);
  };
  const attempt = useRef<Attempt | null>(null);
  const feedback = useRef<HTMLParagraphElement | null>(null);

  // A visit from the past saved in the box below makes an old refusal of the location stale
  // ("Nie mamy zgody…", "Sprawdź ponownie"): the screen starts again from the state of the page.
  if (seenPast !== past) {
    setSeenPast(past);

    if (state.kind !== "recorded") {
      setState({ kind: "idle" });
    }
  }

  // On a phone the button sits in the pinned bar and the message in the section, which may be
  // off screen: bring the result into view. The focus stays where it is (the button keeps it).
  useEffect(() => {
    if (!SCROLLED_KINDS.has(state.kind)) {
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    feedback.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [state.kind]);

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
          // The page is read again (state of the photo, counters of the collection cards, the
          // progress and the next place below); this component stays mounted, so the message
          // and its focus stay too.
          setState({ kind: "recorded", collections: answer.collections });
          router.refresh();
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

  if (visited || state.kind === "recorded") {
    // Right after the visit the server has not answered yet: the answer of the visit gives the
    // progress, without the next place; the refreshed page brings both.
    const items: readonly AfterVisit[] =
      summary.length > 0
        ? summary
        : state.kind === "recorded"
          ? state.collections.map((collection) => ({
              slug: collection.slug,
              title: collection.title,
              ...progressCounts(collection.progress),
              next: null,
            }))
          : [];

    return (
      <div className={styles.box}>
        {state.kind === "recorded" ? (
          <p className={styles.success} role="status" tabIndex={-1} ref={focusOnMount}>
            {visitRecordedText(placeName)}
          </p>
        ) : null}
        {items.length === 0 ? null : (
          <ul className={styles.progress} aria-label="Co dalej">
            {items.map((item) => (
              <li key={item.slug}>
                <span>{remainingInCollectionText(item, item.title)}</span>
                {item.next === null ? null : (
                  <>
                    {" "}
                    <span>
                      Najbliższe nieodwiedzone:{" "}
                      <Link href={`/places/${item.next.id}`}>{item.next.name}</Link>.
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {/* Przypięty stan „Odwiedzone” (telefon); na komputerze `order` stawia go na górze karty. */}
        <PinnedAction>
          <p className={styles.visitedMark}>
            <VisitMark>Odwiedzone</VisitMark>
          </p>
        </PinnedAction>
        {wantedEver ? (
          <WantToSeeButton
            placeId={placeId}
            initialWanted={wantedNow === true}
            onChange={onWantedChange}
          />
        ) : null}
      </div>
    );
  }

  const lost = state.kind === "failed" && state.canRetry;
  const label = lost
    ? "Spróbuj ponownie"
    : state.kind === "out_of_range" || state.kind === "inaccurate" || state.kind === "problem"
      ? "Sprawdź ponownie"
      : past === null
        ? "Potwierdzam wizytę"
        : "Potwierdzam wizytę na miejscu";

  return (
    <div className={styles.box}>
      {/* Wizyta z przeszłości ma jeden znacznik (z datą), w polu „Usuń” niżej; tu go nie powtarzamy. */}
      {/* W przypiętym pasku (telefon) jest tylko przycisk; komunikaty o lokalizacji stoją pod nim
          w treści sekcji, więc nic ich nie zasłania. Po wizycie z przeszłości przycisk jest
          drugorzędny. Stan w trakcie zapisu pokazuje wskaźnik na przycisku, nie napis. */}
      <PinnedAction>
        <button
          type="button"
          className={`button ${past === null ? "button--primary" : "button--outline"} ${styles.action}`}
          disabled={busy}
          aria-busy={busy}
          onClick={() => void (lost ? retry() : check())}
        >
          {label}
        </button>
      </PinnedAction>
      <p
        className={`${styles.feedback} ${
          state.kind === "failed" || state.kind === "problem"
            ? styles.feedbackDanger
            : state.kind === "out_of_range" || state.kind === "inaccurate"
              ? styles.feedbackWarning
              : ""
        }`}
        role={state.kind === "failed" || state.kind === "problem" ? "alert" : "status"}
        ref={feedback}
      >
        {feedbackText(state, radiusM)}
      </p>
      {state.kind === "idle" ? (
        <p className={styles.hint}>
          {past === null
            ? "Przeglądarka zapyta o zgodę na lokalizację. Nie zapisujemy, gdzie jesteś, tylko to, że miejsce trafiło do Twojego albumu."
            : "Potwierdź na miejscu, gdy tu będziesz. Przeglądarka zapyta o zgodę na lokalizację; nie zapisujemy, gdzie jesteś."}
        </p>
      ) : null}
      {/* Drugorzędne akcje zostają w treści, nie w przypiętym pasku: „Zaznaczam wcześniejszą wizytę”
          (wizyta z przeszłości, decyzja P5) i „Chcę zobaczyć”. */}
      <div className={styles.secondaryActions}>
        <PastVisit placeId={placeId} existing={past} showMark={showPastMark} />
        {past !== null && initialWanted !== true ? null : initialWanted === null ? (
          <p className={styles.feedback}>Lista „Chcę zobaczyć” jest chwilowo niedostępna.</p>
        ) : (
          <WantToSeeButton
            placeId={placeId}
            initialWanted={wantedNow === true}
            onChange={onWantedChange}
          />
        )}
      </div>
    </div>
  );
}
