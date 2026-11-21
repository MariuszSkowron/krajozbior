import Link from "next/link";

import { PlaceSources } from "@/app/places/[placeId]/place-sources";
import { WantToSeeButton } from "@/app/places/[placeId]/want-to-see-button";
import { StatusBadge } from "@/design-system/components/status-badge";
import type { PublishedPlace } from "@/features/catalog/application/catalog-types";
import { shortenDescription, type VisitKind } from "@/features/catalog/domain/album-view";

import albumStyles from "./album.module.css";

// What the panel knows about the explorer and the place; `null` marks a part that is not there
// (a guest has no visits; a failed read leaves the part out, the page stays whole).
export type PanelPlace =
  | Readonly<{ status: "none" }>
  | Readonly<{ status: "failed" }>
  | Readonly<{
      status: "ok";
      place: PublishedPlace;
      /** `undefined` for a guest; `null` for an explorer without a visit of the place. */
      visit: VisitKind | null | undefined;
      /** `null` when the read of the list failed (no button then). */
      wanted: boolean | null;
    }>;

// The panel of the chosen place (E12-4, "Laptop · Kolekcja z wybranym miejscem"): shown next to
// the list from 48rem, hidden on a phone, where a card leads to the page of the place. The
// heading is the only live region, so a change of the place is announced by its name and the
// description is not read out. It stays in the page also when nothing is chosen, so the live
// region exists before the first choice.
export function PlacePanel({ panel }: Readonly<{ panel: PanelPlace }>) {
  const ok = panel.status === "ok" ? panel : null;
  const heading =
    ok !== null
      ? ok.place.name
      : panel.status === "failed"
        ? "Nie udało się wczytać miejsca"
        : "Wybrane miejsce";

  return (
    <aside className={albumStyles.panel} aria-labelledby="panel-miejsca">
      <h2 id="panel-miejsca" aria-live="polite">
        {heading}
      </h2>
      {ok === null ? (
        <p>
          {panel.status === "failed"
            ? "Odśwież stronę za chwilę albo otwórz stronę miejsca z karty."
            : "Wybierz kartę miejsca, aby zobaczyć tutaj jego szczegóły albo otwórz stronę miejsca z karty."}
        </p>
      ) : (
        <>
          {ok.visit === undefined ? null : ok.visit === null ? (
            <p>
              <StatusBadge tone="neutral">Do odwiedzenia</StatusBadge>
            </p>
          ) : (
            <p>
              {ok.visit === "on_site" ? (
                <StatusBadge tone="success">Odwiedzone</StatusBadge>
              ) : (
                <StatusBadge tone="info">Z przeszłości</StatusBadge>
              )}
            </p>
          )}
          <dl className={albumStyles.panelFacts}>
            {ok.place.address === "" ? null : (
              <div>
                <dt>Adres</dt>
                <dd>{ok.place.address}</dd>
              </div>
            )}
            {ok.place.accessInfo === "" ? null : (
              <div>
                <dt>Dostęp</dt>
                <dd>{ok.place.accessInfo}</dd>
              </div>
            )}
            {ok.place.description === "" ? null : (
              <div>
                <dt>Opis</dt>
                <dd>{shortenDescription(ok.place.description)}</dd>
              </div>
            )}
          </dl>
          <PlaceSources source={ok.place.source} headingLevel={3} />
          <div className={albumStyles.panelActions}>
            {ok.wanted === null || (ok.visit === "on_site" && !ok.wanted) ? null : (
              <WantToSeeButton key={ok.place.id} placeId={ok.place.id} initialWanted={ok.wanted} />
            )}
            <Link className="button button--outline" href={`/places/${ok.place.id}`}>
              Otwórz stronę miejsca
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}
