import type { Metadata } from "next";
import Link from "next/link";

import { StatusBadge } from "@/design-system/components/status-badge";
import { listCuratorCollections } from "@/features/catalog/application/curator-queries";
import { COLLECTION_STATUS_LABELS, REGION_LABELS } from "@/features/catalog/domain/collection";
import { formatCollectionCount } from "@/features/catalog/domain/search";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { countOpenReports } from "@/features/reports/application/curator-reports";
import { formatOpenReportsCounter } from "@/features/reports/domain/report";
import { getReportsDeps } from "@/features/reports/infrastructure/reports-deps";
import { logFailure } from "@/lib/log-failure";

import styles from "./curator.module.css";
import { firstParam, formatDate, pageValue, requireCurator } from "./curator-session";
import reports from "./reports/reports.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Panel kuratora — Krajozbiór" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The collections of one organization of the curator (E1). With several
// organizations a native select (a form with GET, so it works without
// JavaScript) chooses which one is shown.
export default async function CuratorHome({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const { actor, organizations } = await requireCurator("/curator");
  const requested = firstParam((await searchParams).organization);
  const organization = organizations.find((item) => item.id === requested) ?? organizations[0];
  const collections = pageValue(
    await listCuratorCollections(actor, organization.id, getCatalogDeps()),
    "/curator",
  );
  // The number of reports waiting for this organization (the same condition as the list of the
  // queue). When the count fails the section says so and the collections still show.
  let openReports: number | null = null;
  let reportsUnavailable = false;

  try {
    const reportCount = await countOpenReports(actor, organization.id, getReportsDeps());

    if (reportCount.status === "ok") {
      openReports = reportCount.value;
    }
  } catch (error) {
    logFailure("Open reports count", error);
    reportsUnavailable = true;
  }

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className="eyebrow">Panel kuratora</p>
          <h1>Twoje kolekcje</h1>
          <p className={styles.muted}>
            {organization.name}: {formatCollectionCount(collections.length)}
          </p>
        </div>
        <Link
          className="button button--primary"
          href={`/curator/collections/new?organization=${organization.id}`}
        >
          Nowa kolekcja
        </Link>
      </header>

      {organizations.length > 1 ? (
        <form className={styles.switcher} method="get" action="/curator">
          <div className={styles.field}>
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

      {reportsUnavailable ? (
        <section aria-labelledby="attention-heading" className={reports.attention}>
          <h2 id="attention-heading">Wymaga uwagi</h2>
          <p role="status">Nie udało się sprawdzić zgłoszeń. Odśwież stronę za chwilę.</p>
        </section>
      ) : openReports === null ? null : (
        <section aria-labelledby="attention-heading" className={reports.attention}>
          <h2 id="attention-heading">Wymaga uwagi</h2>
          <div className={reports.attentionRow}>
            {openReports > 0 ? (
              <Link
                className={reports.counter}
                href={`/curator/reports?organization=${organization.id}`}
              >
                {formatOpenReportsCounter(openReports)}
              </Link>
            ) : (
              <>
                <p>{formatOpenReportsCounter(openReports)}</p>
                <Link
                  className={reports.quietLink}
                  href={`/curator/reports?organization=${organization.id}&state=decided`}
                >
                  Rozpatrzone
                </Link>
              </>
            )}
          </div>
        </section>
      )}

      {collections.length === 0 ? (
        <p className={styles.empty}>
          Ta organizacja nie ma jeszcze kolekcji. Utwórz pierwszą przyciskiem „Nowa kolekcja”.
        </p>
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>
              Kolekcje organizacji {organization.name}
            </caption>
            <thead>
              <tr>
                <th scope="col">Nazwa</th>
                <th scope="col">Stan</th>
                <th scope="col">Województwo</th>
                <th scope="col">Miejsca</th>
                <th scope="col">Zmieniono</th>
              </tr>
            </thead>
            <tbody>
              {collections.map((collection) => (
                <tr key={collection.id}>
                  <th scope="row" className={styles.title}>
                    <Link href={`/curator/collections/${collection.id}`}>{collection.title}</Link>
                  </th>
                  <td>
                    <StatusBadge tone={collection.status === "published" ? "success" : "neutral"}>
                      {COLLECTION_STATUS_LABELS[collection.status]}
                    </StatusBadge>
                  </td>
                  <td>{REGION_LABELS[collection.region]}</td>
                  <td>{collection.placeCount}</td>
                  <td>{formatDate(collection.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
