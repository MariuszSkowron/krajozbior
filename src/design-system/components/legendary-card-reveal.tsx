"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { LegendaryCard, type LegendaryCardProps } from "./legendary-card";
import styles from "./legendary-card-reveal.module.css";

// Scena odsłonięcia karty legendarnej (E6-4a): zasłona zakrywa kartę, odsłania ją kliknięcie,
// dotknięcie, Enter albo Spacja (natywny przycisk), a przesunięcie w górę jest tylko dodatkiem.
// Komponent prezentacyjny: stan zakryta → odsłonięta, gest i fokus to stan interfejsu; dane
// i `POST …/open` dostarcza ekran przez propsy i `onReveal`. Scena jest zawsze nocna.
//
// Kolejność zdarzeń (DT-E6-4a-2a): akcja od razu, synchronicznie, ustawia stan „odsłonięta”,
// wywołuje `onReveal`, przenosi fokus na kartę i wpisuje komunikat do regionu `aria-live`. Nic
// z tego nie czeka na `animationend`; animacja jest warstwą nad stanem końcowym, a Escape albo
// ponowne kliknięcie karty w trakcie animacji przechodzi od razu do stanu końcowego.
const SWIPE_UP_PX = 110;
// Zapas równy motion.duration.reveal: zdejmuje klasę animacji, gdy `animationend` nie nadejdzie.
const REVEAL_FALLBACK_MS = 1200;

export function LegendaryCardReveal({
  card,
  initialState = "sealed",
  onReveal,
  actions,
  motion = "auto",
}: Readonly<{
  card: Omit<LegendaryCardProps, "playing">;
  initialState?: "sealed" | "revealed";
  onReveal?: () => void;
  /** Przyciski pod kartą po odsłonięciu; składa je ekran. */
  actions?: ReactNode;
  /** `reduce` pokazuje stan końcowy bez ruchu (historie, testy); `auto` idzie za przeglądarką. */
  motion?: "auto" | "reduce";
}>) {
  const [revealed, setRevealed] = useState(initialState === "revealed");
  const [playing, setPlaying] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const headingId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const swipeStart = useRef<number | null>(null);

  // Fokus na karcie po odsłonięciu z akcji (nie przy starcie w stanie odsłoniętym).
  useEffect(() => {
    if (revealed && focusPending.current) {
      focusPending.current = false;
      cardRef.current?.focus();
    }
  }, [revealed]);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setPlaying(false), REVEAL_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [playing]);

  function reveal() {
    if (revealed) return;
    focusPending.current = true;
    setRevealed(true);
    setPlaying(true);
    setAnnouncement(`Odsłonięto kartę: ${card.eventName}, ${card.placeName}, ${card.dateLabel}`);
    onReveal?.();
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    swipeStart.current = event.clientY;
  }

  function onPointerUp(event: PointerEvent<HTMLButtonElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start !== null && start - event.clientY >= SWIPE_UP_PX) reveal();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && playing) setPlaying(false);
  }

  const heading = revealed
    ? card.placeName
    : `Karta z wydarzenia ${card.eventName} czeka w Twojej skrytce`;

  return (
    <section
      className={`theme-dark ${styles.scene}`}
      data-motion={motion === "reduce" ? "reduce" : undefined}
      data-state={revealed ? "revealed" : "sealed"}
      data-playing={playing ? "true" : undefined}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
    >
      <p className={styles.kicker}>Skrytka</p>
      <h2 id={headingId} className={styles.heading}>
        {heading}
      </h2>

      <div className={styles.stage}>
        <div
          ref={cardRef}
          className={styles.cardSlot}
          role="group"
          aria-label={`Karta legendarna: ${card.eventName}`}
          tabIndex={-1}
          inert={!revealed}
          onClick={() => {
            if (playing) setPlaying(false);
          }}
        >
          <LegendaryCard {...card} playing={playing} />
        </div>
        {!revealed || playing ? (
          <button
            type="button"
            className={styles.veil}
            aria-label={`Odsłoń kartę: ${card.eventName}`}
            aria-hidden={revealed ? "true" : undefined}
            tabIndex={revealed ? -1 : undefined}
            disabled={revealed}
            onClick={reveal}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              swipeStart.current = null;
            }}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setPlaying(false);
            }}
          >
            <span className={styles.veilRing} aria-hidden="true" />
            <span aria-hidden="true">Odsłoń kartę</span>
          </button>
        ) : null}
      </div>

      {revealed ? null : (
        <p className={styles.hint}>
          <span className={styles.hintArrow} aria-hidden="true">
            ↑
          </span>{" "}
          Dotknij karty albo przesuń ją w górę
        </p>
      )}

      <div className={styles.live} aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {revealed && actions ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
