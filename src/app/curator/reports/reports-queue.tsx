"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/design-system/components/status-badge";
import {
  DECISION_NOTE_MAX_LENGTH,
  REJECT_REASON_LABELS,
  REJECT_REASONS,
} from "@/features/reports/domain/report";

import curator from "../curator.module.css";
import styles from "./reports.module.css";

export type ReportRow = Readonly<{
  id: string;
  categoryLabel: string;
  message: string;
  status: "open" | "accepted" | "rejected";
  rejectReasonLabel: string | null;
  decisionNote: string | null;
  createdLabel: string;
  decidedLabel: string | null;
  version: number;
  placeName: string;
  placeDeleted: boolean;
  placeHref: string | null;
  editHref: string | null;
  authorLabel: string;
  authorGone: boolean;
}>;

type Notice = Readonly<{
  kind: "info" | "error";
  text: string;
  /** Undo of the decision just made (until the page is reloaded). */
  undo?: Readonly<{ reportId: string; version: number; placeName: string }>;
}>;

type Answer = Readonly<{ ok: true; version: number }> | Readonly<{ ok: false; text: string }>;

function failureText(status: number, reason: unknown): string {
  switch (status) {
    case 401:
      return "Zaloguj się ponownie.";
    case 404:
      return "Nie znaleziono tego zgłoszenia. Odśwież listę.";
    case 409:
      if (reason === "author_gone") {
        return "Autor usunął konto, więc decyzji nie można cofnąć.";
      }

      if (reason === "own_report") {
        return "Własnego zgłoszenia nie rozpatrzysz. Zrobi to ktoś inny z organizacji.";
      }

      return "To zgłoszenie rozpatrzył już ktoś inny. Odśwież listę.";
    case 429:
      return "Za dużo decyzji w krótkim czasie. Spróbuj za chwilę.";
    case 413:
    case 422:
      return "Popraw powód lub notatkę i spróbuj jeszcze raz.";
    default:
      return "Nie udało się zapisać decyzji. Spróbuj ponownie za chwilę.";
  }
}

async function send(reportId: string, body: Record<string, unknown>): Promise<Answer> {
  try {
    const response = await fetch(`/api/curator/reports/${reportId}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      version?: unknown;
      reason?: unknown;
    };

    if (response.ok && typeof payload.version === "number") {
      return { ok: true, version: payload.version };
    }

    return { ok: false, text: failureText(response.status, payload.reason) };
  } catch {
    return { ok: false, text: failureText(0, null) };
  }
}

// The list of reports of one organization. Decisions go through the route; the rules (who may
// decide, the version, the author who left) are the server's: this only sends and tells the answer.
// After a decision the report leaves the list and the focus goes to the heading of the next one.
export function ReportsQueue({
  rows,
  state,
}: Readonly<{ rows: readonly ReportRow[]; state: "open" | "decided" }>) {
  const router = useRouter();
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState<ReportRow | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  const headings = useRef(new Map<string, HTMLHeadingElement>());
  const emptyRef = useRef<HTMLParagraphElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const dialogErrorRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<string | null | undefined>(undefined);
  // A decided report is hidden by its id and version: when it comes back (undo, a refreshed
  // list) its version is higher, so it shows again.
  const keyOf = (row: ReportRow) => `${row.id}:${row.version}`;
  const visible = rows.filter((row) => !removed.has(keyOf(row)));

  useEffect(() => {
    if (rejecting !== null) {
      dialogRef.current?.showModal();
    }
  }, [rejecting]);

  // A failed rejection is shown inside the open dialog; the focus goes to the message.
  useEffect(() => {
    if (rejecting !== null && notice !== null && notice.kind === "error") {
      dialogErrorRef.current?.focus();
    }
  }, [rejecting, notice]);

  // Focus goes to the next heading (or to the message of an empty list) once the DOM is updated.
  useEffect(() => {
    if (focusAfter.current === undefined) {
      return;
    }

    const target = focusAfter.current;

    focusAfter.current = undefined;

    if (target === null) {
      emptyRef.current?.focus();
    } else {
      headings.current.get(target)?.focus();
    }
  }, [removed]);

  function leave(row: ReportRow) {
    const after = visible.findIndex((item) => item.id === row.id);
    const next = visible[after + 1] ?? visible[after - 1] ?? null;

    focusAfter.current = next === null ? null : next.id;
    setRemoved((current) => new Set(current).add(keyOf(row)));
  }

  async function decide(
    row: ReportRow,
    body: Record<string, unknown>,
    success: (version: number) => Notice,
  ): Promise<boolean> {
    if (pending) {
      return false;
    }

    setPending(true);

    const answer = await send(row.id, { ...body, version: row.version });

    setPending(false);

    if (!answer.ok) {
      setNotice({ kind: "error", text: answer.text });

      return false;
    }

    leave(row);
    setNotice(success(answer.version));
    router.refresh();

    return true;
  }

  const accept = (row: ReportRow) =>
    decide(row, { action: "accept" }, (version) => ({
      kind: "info",
      text: `Przyjęto zgłoszenie dla ${row.placeName}.`,
      undo: { reportId: row.id, version, placeName: row.placeName },
    }));

  const undo = (row: ReportRow) =>
    decide(row, { action: "undo" }, () => ({
      kind: "info",
      text: `Cofnięto decyzję dla ${row.placeName}. Zgłoszenie wróciło do sprawdzenia.`,
    }));

  async function reject() {
    if (rejecting === null) {
      return;
    }

    const reason = reasonRef.current?.value ?? "";

    if (reason === "") {
      setReasonMissing(true);
      reasonRef.current?.focus();

      return;
    }

    const row = rejecting;
    const done = await decide(
      row,
      { action: "reject", reason, note: noteRef.current?.value },
      (version) => ({
        kind: "info",
        text: `Odrzucono zgłoszenie dla ${row.placeName}.`,
        undo: { reportId: row.id, version, placeName: row.placeName },
      }),
    );

    if (done) {
      dialogRef.current?.close();
    }
  }

  // "Cofnij" under the message: the report left the list, so it is not in `rows` of this
  // render; the undo is sent with the version the decision returned.
  async function undoLast(last: NonNullable<Notice["undo"]>) {
    if (pending) {
      return;
    }

    setPending(true);

    const answer = await send(last.reportId, { action: "undo", version: last.version });

    setPending(false);

    if (!answer.ok) {
      setNotice({ kind: "error", text: answer.text });

      return;
    }

    setNotice({
      kind: "info",
      text: `Cofnięto decyzję dla ${last.placeName}. Zgłoszenie wróciło do sprawdzenia.`,
    });
    router.refresh();
    // The "Cofnij" button that had the focus is gone: the focus goes to the message.
    requestAnimationFrame(() => statusRef.current?.focus());
  }

  return (
    <>
      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite">
        {notice !== null && notice.kind === "info" ? (
          <div className={`${styles.notice} ${styles.noticeRow}`}>
            <p className={curator.muted}>{notice.text}</p>
            {notice.undo !== undefined ? (
              <button
                type="button"
                className="button button--outline"
                aria-disabled={pending}
                onClick={() => undoLast(notice.undo!)}
              >
                Cofnij
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {notice !== null && notice.kind === "error" && rejecting === null ? (
        <p role="alert" className={styles.notice}>
          {notice.text}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p ref={emptyRef} tabIndex={-1} className={`${curator.empty} ${styles.emptyState}`}>
          {state === "open"
            ? "Nic nie czeka na decyzję. Gdy odkrywca zgłosi problem z miejscem Twojej organizacji, zobaczysz go tutaj."
            : "Nie ma jeszcze rozpatrzonych zgłoszeń."}
        </p>
      ) : (
        <ul className={styles.list}>
          {visible.map((row) => (
            <li key={row.id}>
              <article className={styles.report} aria-labelledby={`report-${row.id}`}>
                <h2
                  id={`report-${row.id}`}
                  tabIndex={-1}
                  ref={(element) => {
                    if (element === null) {
                      headings.current.delete(row.id);
                    } else {
                      headings.current.set(row.id, element);
                    }
                  }}
                >
                  {row.placeHref === null ? (
                    <>{row.placeName} (miejsce usunięte)</>
                  ) : (
                    <Link href={row.placeHref}>{row.placeName}</Link>
                  )}
                </h2>
                <p className={styles.reportMeta}>
                  <StatusBadge tone="neutral">{row.categoryLabel}</StatusBadge>
                  <span>{row.createdLabel}</span>
                  <span>Zgłoszenie od: {row.authorLabel}</span>
                </p>
                {row.message === "" ? (
                  <p className={styles.removed}>
                    {row.authorGone
                      ? "Opis usunięty razem z kontem autora."
                      : "Zgłaszający nie dodał opisu."}
                  </p>
                ) : (
                  <p className={styles.message}>{row.message}</p>
                )}
                {state === "decided" ? (
                  <>
                    <p className={styles.decision}>
                      <StatusBadge tone={row.status === "accepted" ? "success" : "warning"}>
                        {row.status === "accepted" ? "Przyjęte" : "Odrzucone"}
                      </StatusBadge>{" "}
                      {row.rejectReasonLabel === null ? null : (
                        <>Powód: {row.rejectReasonLabel}. </>
                      )}
                      {row.decidedLabel === null ? null : <>Decyzja: {row.decidedLabel}.</>}
                    </p>
                    {row.decisionNote === null ? null : (
                      <p className={styles.decision}>Notatka: {row.decisionNote}</p>
                    )}
                  </>
                ) : null}
                <div className={curator.actions}>
                  {state === "open" ? (
                    <>
                      <button
                        type="button"
                        className={`button button--primary ${curator.pending}`}
                        aria-disabled={pending}
                        onClick={() => accept(row)}
                      >
                        Przyjmij
                      </button>
                      <button
                        type="button"
                        className="button button--outline"
                        onClick={() => {
                          setReasonMissing(false);
                          setNotice(null);
                          setRejecting(row);
                        }}
                      >
                        Odrzuć
                      </button>
                      {row.editHref === null ? null : (
                        <Link className="button button--outline" href={row.editHref}>
                          Edytuj miejsce
                        </Link>
                      )}
                    </>
                  ) : row.authorGone ? (
                    <p className={styles.decision}>
                      Autor usunął konto, więc decyzji nie można cofnąć. Jeśli trzeba, popraw
                      miejsce w edytorze.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className={`button button--outline ${curator.pending}`}
                      aria-disabled={pending}
                      onClick={() => undo(row)}
                    >
                      Cofnij decyzję
                    </button>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <dialog
        ref={dialogRef}
        className={curator.dialog}
        aria-labelledby="reject-heading"
        onClose={() => setRejecting(null)}
      >
        {rejecting === null ? null : (
          <form
            className={styles.rejectForm}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void reject();
            }}
          >
            <h2 id="reject-heading">Odrzucić zgłoszenie dla {rejecting.placeName}?</h2>
            <div className={curator.field}>
              <label htmlFor="reject-reason">Powód</label>
              <select
                id="reject-reason"
                ref={reasonRef}
                defaultValue=""
                aria-invalid={reasonMissing}
                aria-describedby={reasonMissing ? "reject-reason-error" : undefined}
              >
                <option value="" disabled>
                  Wybierz powód
                </option>
                {REJECT_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {REJECT_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
              {reasonMissing ? (
                <p id="reject-reason-error" className={curator.fieldError}>
                  <span className={curator.errorPrefix}>Błąd: </span>
                  Wybierz powód odrzucenia.
                </p>
              ) : null}
            </div>
            <div className={curator.field}>
              <label htmlFor="reject-note">Notatka dla zgłaszającego (nieobowiązkowa)</label>
              <textarea
                id="reject-note"
                ref={noteRef}
                rows={3}
                maxLength={DECISION_NOTE_MAX_LENGTH}
                aria-describedby="reject-note-help"
              />
              <p id="reject-note-help" className={curator.help}>
                Zgłaszający zobaczy ją przy swoim zgłoszeniu, bez Twojego nazwiska. Do{" "}
                {DECISION_NOTE_MAX_LENGTH} znaków.
              </p>
            </div>
            {/* The dialog is modal: a message outside of it would be inert, so a failed
                rejection says so here, where the curator is (and the focus moves to it). */}
            {notice !== null && notice.kind === "error" ? (
              <p
                ref={dialogErrorRef}
                role="alert"
                tabIndex={-1}
                className={curator.fieldError}
                id="reject-error"
              >
                <span className={curator.errorPrefix}>Błąd: </span>
                {notice.text}
              </p>
            ) : null}
            <div className={curator.actions}>
              <button
                type="submit"
                className={`button button--danger ${curator.pending}`}
                aria-disabled={pending}
              >
                Odrzuć zgłoszenie
              </button>
              <button
                type="button"
                className="button button--outline"
                onClick={() => dialogRef.current?.close()}
              >
                Anuluj
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
