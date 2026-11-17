import type { Metadata } from "next";
import Link from "next/link";

import { listCuratorCollections } from "@/features/catalog/application/curator-queries";
import { COLLECTION_STATUS_LABELS, REGION_LABELS } from "@/features/catalog/domain/collection";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";

import styles from "./curator.module.css";
import { firstParam, formatDate, pageValue, requireCurator } from "./curator-session";

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

  return (
    <>
      <header className={styles.pageHead}>
        <div>
          <p className="eyebrow">Panel kuratora</p>
          <h1>Twoje kolekcje</h1>
          <p className={styles.muted}>
            {organization.name}: {collections.length}{" "}
            {collections.length === 1 ? "kolekcja" : "kolekcji"}
          </p>
        </div>
        <Link
          className={styles.primaryLink}
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
          <button type="submit" className={styles.secondary}>
            Pokaż
          </button>
        </form>
      ) : null}

      {collections.length === 0 ? (
        <p className={styles.empty}>
          Ta organizacja nie ma jeszcze kolekcji. Utwórz pierwszą przyciskiem „Nowa kolekcja”.
        </p>
      ) : (
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
                  <span
                    className={`${styles.badge} ${
                      collection.status === "published" ? styles.badgePublished : styles.badgeDraft
                    }`}
                  >
                    {COLLECTION_STATUS_LABELS[collection.status]}
                  </span>
                </td>
                <td>{REGION_LABELS[collection.region]}</td>
                <td>{collection.placeCount}</td>
                <td>{formatDate(collection.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
