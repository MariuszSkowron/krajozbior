import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { loginHref } from "@/app/request-actor";
import { getReportQueue } from "@/features/reports/application/curator-reports";
import {
  formatQueueOverflow,
  isReportQueueState,
  REJECT_REASON_LABELS,
  REPORT_CATEGORY_LABELS,
} from "@/features/reports/domain/report";
import { getReportsDeps } from "@/features/reports/infrastructure/reports-deps";

import curator from "../curator.module.css";
import { firstParam, formatDate, requireCurator } from "../curator-session";
import styles from "./reports.module.css";
import { ReportsQueue, type ReportRow } from "./reports-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Zgłoszenia od odkrywców — Panel kuratora" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The queue of reports of one organization (P4b): "Do sprawdzenia" (the oldest first) and
// "Rozpatrzone" (the latest decisions). Only on a computer, like the whole panel.
export default async function CuratorReports({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const { actor, organizations } = await requireCurator("/curator/reports");
  const params = await searchParams;
  const requested = firstParam(params.organization);
  const organization = organizations.find((item) => item.id === requested) ?? organizations[0];
  const requestedState = firstParam(params.state);
  const state = isReportQueueState(requestedState) ? requestedState : "open";
  const outcome = await getReportQueue(actor, organization.id, state, getReportsDeps());

  if (outcome.status === "unauthenticated") {
    redirect(loginHref("/curator/reports"));
  }

  if (outcome.status !== "ok") {
    notFound();
  }

  const { items, openTotal } = outcome.value;
  const overflow = state === "open" ? formatQueueOverflow(openTotal) : null;
  const rows: ReportRow[] = items.map((item) => ({
    id: item.id,
    categoryLabel: REPORT_CATEGORY_LABELS[item.category],
    message: item.message,
    status: item.status,
    rejectReasonLabel: item.rejectReason === null ? null : REJECT_REASON_LABELS[item.rejectReason],
    decisionNote: item.decisionNote,
    createdLabel: formatDate(item.createdAt),
    decidedLabel: item.decidedAt === null ? null : formatDate(item.decidedAt),
    version: item.version,
    placeName: item.placeName,
    placeDeleted: item.placeDeleted,
    placeHref: item.placeId === null ? null : `/places/${item.placeId}`,
    editHref:
      item.placeId === null || item.editCollectionId === null
        ? null
        : `/curator/collections/${item.editCollectionId}/places/${item.placeId}`,
    authorLabel: item.authorLabel,
    authorGone: item.authorGone,
  }));
  const own = `?organization=${organization.id}`;

  return (
    <>
      <header className={curator.pageHead}>
        <div>
          <p className="eyebrow">Panel kuratora</p>
          <h1>Zgłoszenia od odkrywców</h1>
          <p className={curator.muted}>{organization.name}</p>
        </div>
      </header>

      {organizations.length > 1 ? (
        <form className={curator.switcher} method="get" action="/curator/reports">
          <input type="hidden" name="state" value={state} />
          <div className={curator.field}>
            <label htmlFor="organization">Organizacja</label>
            <select id="organization" name="organization" defaultValue={organization.id}>
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="button button--outline">
            Pokaż organizację
          </button>
        </form>
      ) : null}

      <nav aria-label="Zgłoszenia">
        <ul className={styles.tabs}>
          <li>
            <Link
              className={styles.tab}
              href={`/curator/reports${own}`}
              aria-current={state === "open" ? "page" : undefined}
            >
              Do sprawdzenia ({openTotal})
            </Link>
          </li>
          <li>
            <Link
              className={styles.tab}
              href={`/curator/reports${own}&state=decided`}
              aria-current={state === "decided" ? "page" : undefined}
            >
              Rozpatrzone
            </Link>
          </li>
        </ul>
      </nav>

      {overflow === null ? null : <p className={styles.overflow}>{overflow}</p>}

      <ReportsQueue key={`${organization.id}-${state}`} rows={rows} state={state} />
    </>
  );
}
