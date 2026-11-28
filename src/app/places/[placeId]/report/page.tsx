import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getRequestActor, logReadFailure, loginHref } from "@/app/request-actor";
import { getApprovedOrganizations } from "@/app/request-organizations";
import { getPublishedPlace } from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import { formatFormHeading, OWN_ORGANIZATION_NOTICE } from "@/features/reports/domain/report-texts";
import { isPlaceReportsEnabled } from "@/lib/config/env";

import { ReportForm } from "./report-form";
import styles from "./report-form.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Zgłoś problem z miejscem — Krajozbiór" };

type Params = Promise<{ placeId: string }>;

// P4b, PR B: the form of a report of a problem with a place. The whole page is behind the switch
// FEATURE_PLACE_REPORTS (off: 404, nothing is collected); a guest is sent to sign in and back here;
// a member of the organization of the place is told to correct it in the editor instead.
export default async function ReportPlacePage({ params }: { params: Params }) {
  if (!isPlaceReportsEnabled()) {
    notFound();
  }

  const { placeId } = await params;
  const path = `/places/${placeId}/report`;
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref(path));
  }

  let result;

  try {
    result = await getPublishedPlace(placeId, getCatalogDeps());
  } catch (error) {
    logReadFailure("Place report page read", error);
    throw new Error("Public place read failed");
  }

  if (result.status !== "ok") {
    notFound();
  }

  const place = result.value;
  let organizations: Awaited<ReturnType<typeof getApprovedOrganizations>> = [];

  try {
    organizations = await getApprovedOrganizations();
  } catch (error) {
    logReadFailure("Place report page organizations", error);
  }

  const own = organizations.some((organization) => organization.slug === place.organization.slug);
  // The editor of the place sits in the first collection of the place (the panel decides who may open it).
  const editHref =
    place.collections[0] === undefined
      ? "/curator"
      : `/curator/collections/${place.collections[0].id}/places/${place.id}`;

  return (
    <div className={`content-width ${styles.page}`}>
      <Link className={styles.back} href={`/places/${place.id}`}>
        ← {place.name}
      </Link>
      <h1 id="report-title">{formatFormHeading(place.name)}</h1>
      {own ? (
        <p>
          {OWN_ORGANIZATION_NOTICE}{" "}
          <Link className={styles.back} href={editHref}>
            Otwórz edytor
          </Link>
        </p>
      ) : (
        <ReportForm placeId={place.id} />
      )}
    </div>
  );
}
