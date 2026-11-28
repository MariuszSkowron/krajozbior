import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { StatusBadge } from "@/design-system/components/status-badge";
import { listMyReports } from "@/features/reports/application/explorer-reports";
import { REPORT_CATEGORY_LABELS } from "@/features/reports/domain/report";
import {
  DISAGREE_LINK,
  DISAGREE_PROMPT,
  formatMyReportState,
  formatPlaceName,
  formatRejectReason,
  MY_REPORTS_EMPTY,
  MY_REPORTS_EMPTY_LINK,
  MY_REPORTS_TITLE,
} from "@/features/reports/domain/report-texts";
import { getReportsDeps } from "@/features/reports/infrastructure/reports-deps";
import { CONTACT_EMAIL } from "@/features/legal/domain/legal-pages";
import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";
import { isPlaceReportsEnabled } from "@/lib/config/env";

import styles from "./my-reports.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Moje zgłoszenia — Krajozbiór" };

const TONES = { open: "neutral", accepted: "success", rejected: "warning" } as const;

// P4b, PR B: the author's own reports and what the curator decided. Behind the switch
// FEATURE_PLACE_REPORTS (off: 404). A report names the organization, never the curator.
export default async function MyReportsPage() {
  if (!isPlaceReportsEnabled()) {
    notFound();
  }

  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref("/my/reports"));
  }

  let result;

  try {
    result = await listMyReports(actor, getReportsDeps());
  } catch (error) {
    logReadFailure("My reports read", error);
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("My reports read failed");
  }

  if (result.status !== "ok") {
    redirect(loginHref("/my/reports"));
  }

  const reports = result.items;

  return (
    <div className={`content-width ${styles.page}`}>
      <header className={styles.header}>
        <h1>{MY_REPORTS_TITLE}</h1>
      </header>
      {reports.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.empty}>{MY_REPORTS_EMPTY}</p>
          <Link className="button button--outline" href="/">
            {MY_REPORTS_EMPTY_LINK}
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {reports.map((report) => {
            const reason = formatRejectReason(report.rejectReason);

            return (
              <li key={report.id} className={styles.item}>
                <article aria-labelledby={`report-${report.id}`}>
                  <h2 id={`report-${report.id}`} className={styles.place}>
                    {report.placeDeleted ? (
                      formatPlaceName(report.placeName, true)
                    ) : (
                      <Link href={`/places/${report.placeId}`}>{report.placeName}</Link>
                    )}
                  </h2>
                  <p className={styles.meta}>
                    {REPORT_CATEGORY_LABELS[report.category]} · {formatSavedDate(report.createdAt)}
                  </p>
                  <p>
                    <StatusBadge tone={TONES[report.status]}>
                      {formatMyReportState(report.status)}
                    </StatusBadge>
                  </p>
                  {reason === null ? null : <p>{reason}</p>}
                  {report.decisionNote === null ? null : (
                    <p className={styles.note}>Notatka kuratora: {report.decisionNote}</p>
                  )}
                  {report.organizationName === "" ? null : (
                    <p className={styles.meta}>Zgłoszenie do: {report.organizationName}</p>
                  )}
                  {report.status === "rejected" ? (
                    <p>
                      {DISAGREE_PROMPT}{" "}
                      <a className={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
                        {DISAGREE_LINK}
                      </a>
                      .
                    </p>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
