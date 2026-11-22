import { NEWS_DELETE_AFTER_WITHDRAWAL_DAYS, NEWS_UPDATED_NOTE_MINUTES } from "./limits";

export const NEWS_KINDS = ["new_place", "info_change", "event", "guide", "community"] as const;

/** The organizations the news import may write to (D-33) and whose news is marked editorial; the first one is the default. */
export const NEWS_EDITORIAL_ORG_SLUGS: readonly string[] = ["krajozbior-redakcja"];

export type NewsKind = (typeof NEWS_KINDS)[number];

// Polish names of the kinds, as in the mockup (the interface never shows the key).
export const NEWS_KIND_LABELS: Readonly<Record<NewsKind, string>> = {
  new_place: "Nowe miejsce",
  info_change: "Zmiana informacji",
  event: "Wydarzenie",
  guide: "Poradnik",
  community: "Społeczność",
};

export const NEWS_STATUSES = ["draft", "published", "withdrawn", "hidden"] as const;

export type NewsStatus = (typeof NEWS_STATUSES)[number];

// Polish names of the states shown to a curator.
export const NEWS_STATUS_LABELS: Readonly<Record<NewsStatus, string>> = {
  draft: "Szkic",
  published: "Opublikowana",
  withdrawn: "Wycofana",
  hidden: "Ukryta przez zespół",
};

export function isNewsKind(value: unknown): value is NewsKind {
  return typeof value === "string" && (NEWS_KINDS as readonly string[]).includes(value);
}

export function isNewsStatus(value: unknown): value is NewsStatus {
  return typeof value === "string" && (NEWS_STATUSES as readonly string[]).includes(value);
}

// Transitions a curator (the application role) may make. `published -> published`
// is an edit of a published item. `hidden` is outside this list on purpose.
const CURATOR_TRANSITIONS: Readonly<Record<NewsStatus, readonly NewsStatus[]>> = {
  draft: ["published"],
  published: ["published", "withdrawn"],
  withdrawn: ["published"],
  hidden: [],
};

// Transitions only the operator makes (`ops_hide_news`, `ops_restore_news`, D-E7-2).
const OPERATOR_TRANSITIONS: Readonly<Record<NewsStatus, readonly NewsStatus[]>> = {
  draft: [],
  published: ["hidden"],
  withdrawn: ["hidden"],
  hidden: ["withdrawn"],
};

export function canCuratorTransition(from: NewsStatus, to: NewsStatus): boolean {
  return CURATOR_TRANSITIONS[from].includes(to);
}

export function canOperatorTransition(from: NewsStatus, to: NewsStatus): boolean {
  return OPERATOR_TRANSITIONS[from].includes(to);
}

/** Only a published item is public (the organization must be approved too, which the database decides). */
export function isNewsPublic(status: NewsStatus): boolean {
  return status === "published";
}

/** A curator edits a draft, a published or a withdrawn item, never a hidden one. */
export function isNewsEditable(status: NewsStatus): boolean {
  return status !== "hidden";
}

export type NewsDeletion =
  | Readonly<{ deletable: true }>
  | Readonly<{ deletable: false; reason: "status" }>
  | Readonly<{ deletable: false; reason: "too_early"; deletableFrom: Date }>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Q13: a draft may be deleted at once, a withdrawn item only 14 days after the
 * withdrawal (the evidence of what was published), a published or hidden one never.
 * A withdrawn item without a withdrawal time is treated as not deletable.
 */
export function newsDeletion(
  status: NewsStatus,
  withdrawnAt: Date | null,
  now: Date,
): NewsDeletion {
  if (status === "draft") {
    return { deletable: true };
  }

  if (status !== "withdrawn" || withdrawnAt === null) {
    return { deletable: false, reason: "status" };
  }

  const deletableFrom = new Date(
    withdrawnAt.getTime() + NEWS_DELETE_AFTER_WITHDRAWAL_DAYS * DAY_MS,
  );

  return now.getTime() >= deletableFrom.getTime()
    ? { deletable: true }
    : { deletable: false, reason: "too_early", deletableFrom };
}

/**
 * D-E7-9: the card says "Zaktualizowano" when the content changed more than 10 minutes
 * after the publication. A missing time on either side means no note.
 */
export function showUpdatedNote(publishedAt: Date | null, contentUpdatedAt: Date | null): boolean {
  if (publishedAt === null || contentUpdatedAt === null) {
    return false;
  }

  return contentUpdatedAt.getTime() - publishedAt.getTime() > NEWS_UPDATED_NOTE_MINUTES * 60 * 1000;
}
