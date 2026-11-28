"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { useHydrated } from "@/app/use-hydrated";
import { REPORT_MESSAGE_MAX_LENGTH } from "@/features/reports/domain/limits";
import {
  normalizeLineBreaks,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  type ReportCategory,
} from "@/features/reports/domain/report";
import {
  CATEGORY_REQUIRED_ERROR,
  CURATOR_SEES_NOTICE,
  formatCharactersLeft,
  formatCounterOver,
  formatMessageTooLong,
  formatSubmitFailure,
  formatSubmitted,
  MESSAGE_HINT,
  MESSAGE_INVALID_ERROR,
  MESSAGE_LABEL,
  MESSAGE_REQUIRED_ERROR,
  MESSAGE_REQUIRED_HINT,
  MY_REPORTS_TITLE,
  OPEN_MY_REPORTS,
  SENT_BACK_TO_PLACE,
  SUBMIT_LABEL,
  SUBMIT_UNAVAILABLE_MESSAGE,
} from "@/features/reports/domain/report-texts";
import { isTextRequired, validateSubmitInput } from "@/features/reports/domain/submit";

import styles from "./report-form.module.css";

type Problem = Readonly<{ category: string | null; message: string | null }>;

// The counter says the number of characters all the time but tells a screen reader only near the
// limit (not at every keystroke).
const ANNOUNCE_FROM = Math.floor(REPORT_MESSAGE_MAX_LENGTH * 0.9);

async function send(placeId: string, category: ReportCategory, message: string) {
  try {
    const response = await fetch(`/api/places/${placeId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, message }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      organizationName?: unknown;
      message?: unknown;
      error?: unknown;
    };

    if (response.ok && typeof payload.organizationName === "string") {
      return { ok: true, organizationName: payload.organizationName } as const;
    }

    return {
      ok: false,
      text: formatSubmitFailure(response.status, payload.message, payload.error),
      duplicate: payload.error === "duplicate_open",
    } as const;
  } catch {
    return { ok: false, text: SUBMIT_UNAVAILABLE_MESSAGE, duplicate: false } as const;
  }
}

// The form of a report of a problem with a place. The rules (who may report, the limits, the
// duplicate) are the server's; this checks what it can say at once and tells the answer. The
// sentence about what the curator sees stands above the button, BEFORE sending (D-62 point 2).
export function ReportForm({ placeId }: Readonly<{ placeId: string }>) {
  const hydrated = useHydrated();
  const [category, setCategory] = useState<ReportCategory | "">("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<Problem>({ category: null, message: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [failureIsDuplicate, setFailureIsDuplicate] = useState(false);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const failureRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const length = [...normalizeLineBreaks(message)].length;
  const over = Math.max(0, length - REPORT_MESSAGE_MAX_LENGTH);

  // The message that appears is where the focus goes (a screen reader reads it).
  useEffect(() => {
    if (failure !== null) {
      failureRef.current?.focus();
    }
  }, [failure]);

  useEffect(() => {
    if (sent !== null) {
      sentRef.current?.focus();
    }
  }, [sent]);

  async function submit() {
    setFailure(null);
    setFailureIsDuplicate(false);

    const checked = validateSubmitInput({ category, message });

    if (!checked.ok) {
      const next: Problem = {
        category: checked.errors.includes("category") ? CATEGORY_REQUIRED_ERROR : null,
        message: checked.errors.includes("message")
          ? category !== "" && isTextRequired(category) && message.trim() === ""
            ? MESSAGE_REQUIRED_ERROR
            : over > 0
              ? formatMessageTooLong(over)
              : MESSAGE_INVALID_ERROR
          : null,
      };

      setProblem(next);
      (next.category !== null ? categoryRef : messageRef).current?.focus();

      return;
    }

    setProblem({ category: null, message: null });
    setPending(true);

    const answer = await send(placeId, checked.value.category, checked.value.message);

    setPending(false);

    if (answer.ok) {
      setSent(formatSubmitted(answer.organizationName));
    } else {
      setFailure(answer.text);
      setFailureIsDuplicate(answer.duplicate);
    }
  }

  if (sent !== null) {
    return (
      <div ref={sentRef} role="status" tabIndex={-1} className={styles.success}>
        <p>{sent}</p>
        <div className={styles.actions}>
          <Link className="button button--primary" href={`/places/${placeId}`}>
            {SENT_BACK_TO_PLACE}
          </Link>
          <Link className="button button--outline" href="/my/reports">
            {MY_REPORTS_TITLE}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.form}
      noValidate
      aria-labelledby="report-title"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset
        className={styles.fieldset}
        aria-invalid={problem.category !== null}
        aria-describedby={problem.category === null ? undefined : "report-category-error"}
      >
        <legend>Rodzaj problemu</legend>
        {REPORT_CATEGORIES.map((item, index) => (
          <div key={item} className={styles.choice}>
            <input
              id={`report-category-${item}`}
              ref={index === 0 ? categoryRef : undefined}
              type="radio"
              name="category"
              value={item}
              checked={category === item}
              onChange={() => setCategory(item)}
            />
            <label htmlFor={`report-category-${item}`}>{REPORT_CATEGORY_LABELS[item]}</label>
          </div>
        ))}
        {problem.category === null ? null : (
          <p id="report-category-error" className={styles.fieldError}>
            <span className={styles.errorPrefix}>Błąd: </span>
            {problem.category}
          </p>
        )}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="report-message">{MESSAGE_LABEL}</label>
        <textarea
          id="report-message"
          ref={messageRef}
          rows={5}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-invalid={problem.message !== null}
          aria-describedby={
            problem.message === null
              ? "report-message-hint report-message-count"
              : "report-message-hint report-message-count report-message-error"
          }
        />
        <p id="report-message-hint" className={styles.hint}>
          {MESSAGE_HINT}
          {category !== "" && isTextRequired(category) ? ` ${MESSAGE_REQUIRED_HINT}` : ""}
        </p>
        <p
          id="report-message-count"
          className={over > 0 ? `${styles.counter} ${styles.counterOver}` : styles.counter}
        >
          {length} / {REPORT_MESSAGE_MAX_LENGTH}
          {over > 0 ? ` — ${formatCounterOver(over)}` : ""}
        </p>
        {/* Announced only near the limit; a count at every keystroke would be noise. */}
        <p className={styles.visuallyHidden} aria-live="polite">
          {over > 0
            ? `${formatCounterOver(over)}.`
            : length === REPORT_MESSAGE_MAX_LENGTH
              ? "Osiągnięto limit znaków."
              : length >= ANNOUNCE_FROM
                ? formatCharactersLeft(REPORT_MESSAGE_MAX_LENGTH - length)
                : ""}
        </p>
        {problem.message === null ? null : (
          <p id="report-message-error" className={styles.fieldError}>
            <span className={styles.errorPrefix}>Błąd: </span>
            {problem.message}
          </p>
        )}
      </div>

      <p className={styles.notice}>{CURATOR_SEES_NOTICE}</p>

      {failure === null ? null : (
        <div ref={failureRef} role="alert" tabIndex={-1} className={styles.error}>
          <p>
            <span className={styles.errorPrefix}>Błąd: </span>
            {failure}
          </p>
          {failureIsDuplicate ? (
            <p>
              <Link href="/my/reports">{OPEN_MY_REPORTS}</Link>
            </p>
          ) : null}
        </div>
      )}

      <button
        className="button button--primary"
        type="submit"
        disabled={!hydrated || pending}
        aria-disabled={!hydrated || pending}
      >
        {SUBMIT_LABEL}
      </button>
    </form>
  );
}
