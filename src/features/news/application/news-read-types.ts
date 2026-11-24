import type { CollectionCover, PlaceCover } from "@/features/catalog/application/catalog-types";
import type { TransactionContext } from "@/lib/db/user-context";

import type { NewsKind } from "../domain/news";

// What a guest sees of a published news item: public fields only, no organization id,
// no version, no status (only published items of approved organizations are read).
export type PublicNewsCard = Readonly<{
  slug: string;
  kind: NewsKind;
  title: string;
  lead: string;
  publishedAt: Date;
  /** `YYYY-MM-DD`; only an event has it. */
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  organization: Readonly<{ name: string; slug: string }>;
  /** `editorial`: the team of Krajozbiór itself; `verified`: an organization approved by the team (Q4). */
  verification: "editorial" | "verified";
  /**
   * The thumbnail inherited from the linked place (first) or collection (T-1 of the spec), or
   * `null`. Public fields only: no author, no licence (a thumbnail has no credit, D-55 pkt 2).
   */
  cover: CollectionCover | null;
}>;

export type PublicNewsItem = Omit<PublicNewsCard, "cover"> &
  Readonly<{
    /** The same photo as on the list, with what its credit needs. */
    cover: PlaceCover | null;
    body: string;
    /** Set only when the content of a published item changed (D-E7-9). */
    contentUpdatedAt: Date | null;
    /** Only a published collection of an approved organization is returned. */
    collection: Readonly<{ slug: string; title: string }> | null;
    /** Only a place of a published collection of an approved organization is returned. */
    place: Readonly<{ id: string; name: string }> | null;
  }>;

export type NewsReadRepository = Readonly<{
  /** Published items of approved organizations, newest first, at most `limit`; one kind or all. */
  listPublished(
    tx: TransactionContext,
    kind: NewsKind | null,
    limit: number,
  ): Promise<readonly Omit<PublicNewsCard, "verification">[]>;
  findPublished(
    tx: TransactionContext,
    slug: string,
  ): Promise<Omit<PublicNewsItem, "verification"> | null>;
}>;

export type NewsReadDeps = Readonly<{
  withGuestContext<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
  repository: NewsReadRepository;
}>;
