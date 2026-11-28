import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { getRequestActor, logReadFailure, loginHref, signupHref } from "@/app/request-actor";
import { getCollectionProgress } from "@/features/album/application/saved-collections";
import { nextPlaceToVisit } from "@/features/album/domain/next-place";
import { progressCounts } from "@/features/album/domain/progress";
import { getAlbumDeps } from "@/features/album/infrastructure/album-deps";
import type { PublishedPlace } from "@/features/catalog/application/catalog-types";
import {
  getPublishedCollection,
  getPublishedPlace,
} from "@/features/catalog/application/public-catalog";
import { getCatalogDeps } from "@/features/catalog/infrastructure/catalog-deps";
import {
  LINK_REPORT_PROBLEM,
  REPORT_CONTENT_HINT,
  REPORT_PROBLEM_HINT,
} from "@/features/reports/domain/report-texts";
import {
  getMyVisitOfPlace,
  listMyVisitKindsOfCollection,
} from "@/features/visits/application/mark-past-visits";
import { pastVisitBadgeText } from "@/features/visits/domain/past-visit-form";
import { formatPastVisitDate } from "@/features/visits/domain/past-visit-request";
import { getVisitDeps } from "@/features/visits/infrastructure/visit-deps";
import { isWantedPlace } from "@/features/want-to-see/application/want-to-see";
import { getWantToSeeDeps } from "@/features/want-to-see/infrastructure/want-to-see-deps";
import { isPlaceReportsEnabled } from "@/lib/config/env";

import albumStyles from "../../my/collections/collections.module.css";
import { ReportContentLink } from "../../report-content-link";
import { PlaceAccessNotice } from "./place-access-notice";
import { PlaceCollections, type CollectionVisitProgress } from "./place-collections";
import styles from "./place-page.module.css";
import { PlacePhoto } from "./place-photo";
import { PlaceSources } from "./place-sources";
import reportStyles from "./report-link.module.css";
import { VisitConfirmation, type AfterVisit } from "./visit-confirmation";

// Same rules as the collection page: dynamic, never in a shared cache (the
// visit state of a signed-in explorer must not reach anyone else).
export const dynamic = "force-dynamic";

type Params = Promise<{ placeId: string }>;

const load = cache(async (placeId: string) => {
  try {
    return await getPublishedPlace(placeId, getCatalogDeps());
  } catch (error) {
    logReadFailure("Public place read", error);

    return { status: "failed" } as const;
  }
});

// What the page adds for the visitor: a guest is sent to sign in and back here,
// an explorer gets the visit button (or the note that the place is visited). A
// failure leaves the public page whole, without the personal part.
async function loadVisit(place: PublishedPlace) {
  const placeId = place.id;
  const collectionIds = place.collections.map((collection) => collection.id);

  try {
    const actor = await getRequestActor();

    if (actor === null) {
      return {
        kind: "guest",
        loginHref: loginHref(`/places/${placeId}`),
        signupHref: signupHref(`/places/${placeId}`),
      } as const;
    }

    const state = await getMyVisitOfPlace(actor, placeId, getVisitDeps());

    if (state.status !== "ok") {
      return { kind: "none" } as const;
    }

    // A failed read of the list hides only the list button (wanted: null); the
    // visit button of the main function stays.
    let wanted: boolean | null = null;

    try {
      const answer = await isWantedPlace(actor, placeId, getWantToSeeDeps());

      wanted = answer.status === "ok" ? answer.value.wanted : null;
    } catch (error) {
      logReadFailure("Place want-to-see read", error);
    }

    // On-site beats past (D-10): a visit confirmed on site is "Odwiedzone"; with only a
    // visit from the past the confirm button stays and the page says when it was.
    const { past } = state.value;

    // The explorer's progress in each collection of the place (usually 1-3); a failed read hides
    // only the progress of that card.
    const progress = new Map<string, CollectionVisitProgress>();

    await Promise.all(
      collectionIds.map(async (collectionId) => {
        try {
          const answer = await getCollectionProgress(actor, collectionId, getAlbumDeps());

          if (answer.status === "ok" && answer.value.progress.kind === "progress") {
            progress.set(collectionId, progressCounts(answer.value.progress));
          }
        } catch (error) {
          logReadFailure("Place collection progress read", error);
        }
      }),
    );

    // After a visit on site: what is left in each collection and the next place of it (the
    // nearest one not visited yet, counted from this place). A failed read leaves out only that line.
    const summary: AfterVisit[] = [];

    // Wizyta z przeszłości też pokazuje „Co dalej” (liczy się jak na miejscu, D-10).
    if (state.value.onSite || past !== null) {
      await Promise.all(
        place.collections.map(async (collection) => {
          // Zapisana kolekcja ma postęp z albumu; w niezapisanej liczymy go z wizyt i miejsc
          // kolekcji (wizyta z przeszłości liczy się jak na miejscu, D-10).
          let counts = progress.get(collection.id);
          let next: AfterVisit["next"] = null;

          try {
            const [published, kinds] = await Promise.all([
              getPublishedCollection(collection.slug, getCatalogDeps()),
              listMyVisitKindsOfCollection(actor, collection.id, getVisitDeps()),
            ]);

            if (published.status === "ok" && kinds.status === "ok") {
              const visitedIds = new Set(kinds.value.map((kind) => kind.placeId));

              next = nextPlaceToVisit(published.value.places, visitedIds, place);
              counts ??= {
                visited: published.value.places.filter((p) => visitedIds.has(p.id)).length,
                total: published.value.places.length,
              };
            }
          } catch (error) {
            logReadFailure("Place next-place read", error);
          }

          if (counts !== undefined) {
            summary.push({ slug: collection.slug, title: collection.title, ...counts, next });
          }
        }),
      );
      summary.sort((a, b) => a.title.localeCompare(b.title, "pl"));
    }

    return {
      kind: "explorer",
      progress,
      summary,
      visited: state.value.onSite,
      past:
        past === null
          ? null
          : pastVisitBadgeText(formatPastVisitDate(past.precision, past.visitedOn)),
      wanted,
    } as const;
  } catch (error) {
    logReadFailure("Place visit read", error);

    return { kind: "unavailable" } as const;
  }
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const result = await load((await params).placeId);

  return result.status === "ok" ? { title: `${result.value.name} — Krajozbiór` } : {};
}

export default async function PlacePage({ params }: { params: Params }) {
  const result = await load((await params).placeId);

  if (result.status === "not_found") {
    notFound();
  }

  if (result.status === "failed") {
    // Handled by error.tsx next to this page: a server error with a Polish message.
    throw new Error("Public place read failed");
  }

  const place = result.value;
  const visit = await loadVisit(place);
  // The first collection (alphabetically) names the place number in the head: "Miejsce 1 z 13 · …".
  const first = place.collections[0];
  // A past visit counts as visited (D-10, same as the progress and the collection page).
  const photoState =
    visit.kind === "explorer"
      ? visit.visited
        ? "visited"
        : visit.past === null
          ? "undiscovered"
          : "past"
      : undefined;

  return (
    <div className={`content-width-wide ${styles.page}`}>
      <div className={styles.top}>
        <header className={styles.head}>
          {first === undefined ? null : (
            <p className={styles.number}>
              Miejsce {first.position} z {first.placeCount} · {first.title}
            </p>
          )}
          <h1 className={styles.title}>{place.name}</h1>
          <p className={styles.curator}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6z" />
            </svg>
            Kurator: {place.organization.name}
          </p>
        </header>
        {place.cover === null ? null : (
          <div className={styles.photo}>
            <PlacePhoto
              cover={place.cover}
              placeName={place.name}
              number={first?.position}
              state={photoState}
              stateText={
                photoState === "past" && visit.kind === "explorer"
                  ? (visit.past ?? undefined)
                  : undefined
              }
            />
          </div>
        )}
        <div className={styles.rest}>
          <PlaceAccessNotice restriction={place.accessRestriction} />
          <VisitSection place={place} visit={visit} />
          <div>
            <dl className={styles.facts}>
              {place.address === "" ? null : (
                <div className={styles.fact}>
                  <dt>Adres</dt>
                  <dd>{place.address}</dd>
                </div>
              )}
              {place.accessInfo === "" ? null : (
                <div className={styles.fact}>
                  <dt>Dostęp</dt>
                  <dd>{place.accessInfo}</dd>
                </div>
              )}
              {place.description === "" ? null : (
                <div className={styles.fact}>
                  <dt>Opis</dt>
                  <dd>{place.description}</dd>
                </div>
              )}
            </dl>
            <PlaceSources source={place.source} />
          </div>
        </div>
      </div>
      <section className={styles.collections} aria-labelledby="kolekcje">
        <h2 id="kolekcje">Kolekcje z tym miejscem</h2>
        <PlaceCollections
          collections={place.collections}
          progress={visit.kind === "explorer" ? visit.progress : new Map()}
        />
        {/* P4b: zgłoszenie problemu z miejscem; bez przełącznika odnośnika nie ma. Gość trafia
            na stronę zgłoszenia, która odsyła go do logowania i z powrotem. Oba odnośniki stoją
            w jednej grupie, każdy z jednym zdaniem o tym, do kogo trafia. */}
        <div className={reportStyles.group}>
          {isPlaceReportsEnabled() ? (
            <div className={reportStyles.item}>
              <p className={reportStyles.hint}>{REPORT_PROBLEM_HINT}</p>
              <p className={reportStyles.report}>
                <Link href={`/places/${place.id}/report`}>{LINK_REPORT_PROBLEM}</Link>
              </p>
            </div>
          ) : null}
          <div className={reportStyles.item}>
            {isPlaceReportsEnabled() ? (
              <p className={reportStyles.hint}>{REPORT_CONTENT_HINT}</p>
            ) : null}
            <p className={reportStyles.report}>
              <ReportContentLink path={`/places/${place.id}`} title={place.name} />
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function VisitSection({
  place,
  visit,
}: {
  place: PublishedPlace;
  visit: Awaited<ReturnType<typeof loadVisit>>;
}) {
  return (
    <section className={styles.visit} aria-labelledby="wizyta">
      <h2 id="wizyta" className={styles.visuallyHidden}>
        Wizyta
      </h2>
      {visit.kind === "guest" ? (
        <div className={albumStyles.guestAction}>
          <Link className="button button--primary" href={visit.signupHref}>
            Załóż konto
          </Link>
          <Link className="button button--outline" href={visit.loginHref}>
            Zaloguj się
          </Link>
          <p className={albumStyles.feedback}>
            Z kontem potwierdzisz wizytę albo zapiszesz miejsce na „Chcę zobaczyć”. Wrócisz na tę
            stronę.
          </p>
        </div>
      ) : visit.kind === "explorer" ? (
        // One component for every state of the explorer's visit: it stays mounted when the page
        // is read again after a saved visit, so the message with the focus is not lost.
        <VisitConfirmation
          key={place.id}
          placeId={place.id}
          placeName={place.name}
          initialWanted={visit.wanted}
          past={visit.past}
          visited={visit.visited}
          summary={visit.summary}
          showPastMark={place.cover === null}
          radiusM={place.visitRadiusM}
        />
      ) : visit.kind === "unavailable" ? (
        <p className={albumStyles.feedback}>
          Nie udało się sprawdzić Twojej wizyty. Odśwież stronę za chwilę.
        </p>
      ) : null}
    </section>
  );
}
