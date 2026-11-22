import { NEWS_EDITORIAL_ORG_SLUGS } from "../domain/news";
import { currentEvents } from "../domain/news-event";
import {
  NEWS_EVENT_FILTER_LIMIT,
  NEWS_LIST_LIMIT,
  isNewsSlug,
  type NewsFilter,
} from "../domain/news-view";
import type { NewsReadDeps, PublicNewsCard, PublicNewsItem } from "./news-read-types";

// The public reading of news (E7-R3). Always the guest context (D-T4): a signed-in
// curator or administrator gets exactly what a guest gets, so no draft, no withdrawn
// item and nothing of a suspended organization can appear. The database decides what
// is public (RLS `news_posts_public_select`); the queries repeat the condition.

function verificationOf(organizationSlug: string): PublicNewsCard["verification"] {
  return NEWS_EDITORIAL_ORG_SLUGS.includes(organizationSlug) ? "editorial" : "verified";
}

/**
 * The newest published items, or only the events that are on or still to come
 * (by start date) for the filter "Wydarzenia". The clock is a parameter for tests.
 */
export async function listPublicNews(
  filter: NewsFilter,
  deps: NewsReadDeps,
  now: Date = new Date(),
): Promise<readonly PublicNewsCard[]> {
  const rows = await deps.withGuestContext((tx) =>
    filter === "events"
      ? deps.repository.listPublished(tx, "event", NEWS_EVENT_FILTER_LIMIT)
      : deps.repository.listPublished(tx, null, NEWS_LIST_LIMIT),
  );
  const cards = rows.map((row) => ({
    ...row,
    verification: verificationOf(row.organization.slug),
  }));

  return filter === "events" ? currentEvents(cards, now).slice(0, NEWS_LIST_LIMIT) : cards;
}

export type PublicNewsResult =
  Readonly<{ status: "ok"; value: PublicNewsItem }> | Readonly<{ status: "not_found" }>;

/** One published item by its address; a malformed address never reaches the database. */
export async function getPublicNews(slug: string, deps: NewsReadDeps): Promise<PublicNewsResult> {
  if (!isNewsSlug(slug)) {
    return { status: "not_found" };
  }

  const found = await deps.withGuestContext((tx) => deps.repository.findPublished(tx, slug));

  return found === null
    ? { status: "not_found" }
    : { status: "ok", value: { ...found, verification: verificationOf(found.organization.slug) } };
}
