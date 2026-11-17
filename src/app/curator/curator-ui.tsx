"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { ErrorIcon } from "@/design-system/patterns/error-icon";

import styles from "./curator.module.css";
import { fieldHints, type Failure } from "./failure-message";

// Small pieces shared by the panel forms. Native elements only: a label for
// every control, the error tied to its field (aria-describedby), the summary
// of errors announced and focused (docs/design/accessibility.md, "Walidacja").

export type Feedback =
  | Readonly<{ kind: "success"; message: string }>
  | Readonly<{ kind: "info"; message: string }>
  | (Failure & Readonly<{ kind: "error" }>);

export const failed = (failure: Failure): Feedback => ({ kind: "error", ...failure });

type FeedbackRegionProps = Readonly<{
  feedback: Feedback | null;
  /** Field name -> [id of the control, its label], for the links of the summary. */
  fields?: Readonly<Record<string, readonly [string, string]>>;
  onReload?: () => void;
}>;

export function FeedbackRegion({ feedback, fields = {}, onReload }: FeedbackRegionProps) {
  const alertRef = useRef<HTMLDivElement>(null);
  const isError = feedback?.kind === "error";

  useEffect(() => {
    if (isError) {
      alertRef.current?.focus();
    }
  }, [isError, feedback]);

  return (
    <div className={styles.feedback}>
      <div role="status">
        {feedback !== null && feedback.kind !== "error" ? (
          <p className={styles.notice}>{feedback.message}</p>
        ) : null}
      </div>
      {feedback !== null && feedback.kind === "error" ? (
        <div ref={alertRef} role="alert" tabIndex={-1} className={styles.errorSummary}>
          <p className={styles.errorLine}>
            <span className={styles.errorPrefix}>
              <ErrorIcon />
              Błąd:{" "}
            </span>
            {feedback.message}
          </p>
          {feedback.fields.length > 0 ? (
            <ul>
              {feedback.fields.map((name) => (
                <li key={name}>
                  {fields[name] === undefined ? (
                    (fieldHints[name] ?? name)
                  ) : (
                    <a href={`#${fields[name][0]}`}>
                      {fields[name][1]}: {fieldHints[name] ?? "popraw wartość"}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {feedback.stale && onReload !== undefined ? (
            <button type="button" className={styles.secondary} onClick={onReload}>
              Wczytaj aktualną wersję
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ControlAria = Readonly<{
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}>;

type FieldProps = Readonly<{
  id: string;
  label: string;
  help?: string;
  /** Set when the server refused this field. */
  invalidHint?: string;
  children: (aria: ControlAria) => ReactNode;
}>;

export function Field({ id, label, help, invalidHint, children }: FieldProps) {
  const helpId = help === undefined ? undefined : `${id}-help`;
  const errorId = invalidHint === undefined ? undefined : `${id}-error`;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        "aria-invalid": invalidHint === undefined ? undefined : true,
        "aria-describedby": describedBy,
      })}
      {help === undefined ? null : (
        <p id={helpId} className={styles.help}>
          {help}
        </p>
      )}
      {invalidHint === undefined ? null : (
        <p id={errorId} className={styles.fieldError}>
          <span className={styles.errorPrefix}>
            <ErrorIcon />
            Błąd:{" "}
          </span>
          {invalidHint}
        </p>
      )}
    </div>
  );
}
