import type { Metadata } from "next";
import Link from "next/link";

import { CollectionForm } from "../../collection-form";
import styles from "../../curator.module.css";
import { firstParam, requireCurator } from "../../curator-session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Nowa kolekcja — Krajozbiór" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// A new collection is always a draft (the server decides, whatever is sent).
// The owner organization is one of the curator's own; the database checks it.
// With several organizations the form always sends the chosen one.
export default async function NewCollectionPage({
  searchParams,
}: Readonly<{ searchParams: SearchParams }>) {
  const { organizations } = await requireCurator("/curator/collections/new");
  const requested = firstParam((await searchParams).organization);
  const organization = organizations.find((item) => item.id === requested) ?? organizations[0];

  return (
    <>
      <nav className={styles.breadcrumb} aria-label="Ścieżka">
        <ol>
          <li>
            <Link href="/curator">Kolekcje</Link>
          </li>
          <li aria-current="page">Nowa kolekcja</li>
        </ol>
      </nav>
      <header className={styles.pageHead}>
        <div>
          <p className="eyebrow">{organization.name}</p>
          <h1>Nowa kolekcja</h1>
          <p className={styles.muted}>
            Zacznij od nazwy i opisu. Miejsca dodasz po utworzeniu szkicu; kolekcję zobaczą odkrywcy
            dopiero po publikacji.
          </p>
        </div>
      </header>
      <CollectionForm mode="create" organizationId={organization.id} />
    </>
  );
}
