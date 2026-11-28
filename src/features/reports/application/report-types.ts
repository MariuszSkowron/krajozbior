import type { Actor } from "@/features/identity/domain/actor";
import type { ActionRateLimiter } from "@/features/identity/domain/action-rate-limit";
import type { TransactionContext } from "@/lib/db/user-context";

import type {
  RejectReason,
  ReportAction,
  ReportCategory,
  ReportQueueState,
  ReportStatus,
} from "../domain/report";

// One report as a curator sees it. There is no author id, no e-mail and no id of the deciding
// curator here, by design: the database functions do not return them (spec 5.2).
export type QueueItem = Readonly<{
  id: string;
  category: ReportCategory;
  message: string;
  status: ReportStatus;
  rejectReason: RejectReason | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  version: number;
  placeId: string | null;
  placeName: string;
  placeDeleted: boolean;
  /** "Anna K.", "Odkrywca" or "Konto usunięte". */
  authorLabel: string;
  authorGone: boolean;
  /** The collection whose editor opens the place, or `null` (place removed or in none). */
  editCollectionId: string | null;
}>;

export type ReportQueue = Readonly<{
  state: ReportQueueState;
  items: readonly QueueItem[];
  /** All open reports of the organization (the same condition as the list, no limit). */
  openTotal: number;
}>;

export type DecisionRefusal =
  "stale_version" | "author_gone" | "own_report" | "invalid_state" | "duplicate_open";

// One report as its author sees it in "Moje zgłoszenia". No id of the deciding curator and no
// name of a person: the organization is a name, and the columns are chosen one by one.
export type MyReport = Readonly<{
  id: string;
  category: ReportCategory;
  status: ReportStatus;
  rejectReason: RejectReason | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  placeId: string | null;
  placeName: string;
  placeDeleted: boolean;
  organizationName: string;
}>;

export type SubmitInput = Readonly<{ placeId: string; category: ReportCategory; message: string }>;

// The answer of the repository to a new report: the database refuses with a code (limits, a
// duplicate, a target the author may not report).
export type InsertResult =
  | Readonly<{ status: "ok"; id: string; organizationName: string }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "own_organization" }>
  | Readonly<{ status: "daily_limit" }>
  | Readonly<{ status: "open_limit" }>
  | Readonly<{ status: "place_queue_full" }>
  | Readonly<{ status: "duplicate_open" }>;

export type SubmitOutcome =
  | Readonly<{ status: "ok"; value: Readonly<{ id: string; organizationName: string }> }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "invalid"; errors: readonly string[] }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "own_organization" }>
  | Readonly<{
      status: "rate_limited";
      reason: "burst" | "daily" | "open";
      retryAfterSeconds?: number;
    }>
  | Readonly<{ status: "place_queue_full" }>
  | Readonly<{ status: "duplicate_open" }>;

export type MyReportsOutcome =
  Readonly<{ status: "ok"; items: readonly MyReport[] }> | Readonly<{ status: "unauthenticated" }>;

export type DecisionResult =
  | Readonly<{ status: "ok"; version: number }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "conflict"; reason: DecisionRefusal }>
  | Readonly<{ status: "invalid" }>;

export type DecideInput = Readonly<{
  reportId: string;
  action: ReportAction;
  reason: RejectReason | null;
  note: string | null;
  version: number;
}>;

// Raw SQL on the transaction of the use case (user context), so the row policies and the
// functions of the database decide. Nothing here names a user id.
export type ReportsRepository = Readonly<{
  /** Organizations of which the actor is a member (approved ones only; the database decides). */
  permittedOrganizationIds(tx: TransactionContext): Promise<readonly string[]>;
  countOpen(tx: TransactionContext, organizationId: string): Promise<number>;
  listQueue(
    tx: TransactionContext,
    organizationId: string,
    state: ReportQueueState,
  ): Promise<readonly QueueItem[]>;
  decide(tx: TransactionContext, input: DecideInput): Promise<DecisionResult>;
  /** Sends a report as the actor of the transaction; the database sets the author and the addressee. */
  insertReport(tx: TransactionContext, input: SubmitInput): Promise<InsertResult>;
  /** The actor's own reports, the newest first (at most 200). */
  listMine(tx: TransactionContext): Promise<readonly MyReport[]>;
}>;

export type ReportsDeps = Readonly<{
  /** The same write limit as the other writes of a curator (counted per user). */
  limiter: ActionRateLimiter;
  withUserContext: <T>(actor: Actor, work: (tx: TransactionContext) => Promise<T>) => Promise<T>;
  repository: ReportsRepository;
}>;

// A decision is a write, so besides the outcomes below it can be refused by the write limit.
export type DecisionOutcome<T> =
  ReportOutcome<T> | Readonly<{ status: "rate_limited"; retryAfterSeconds: number }>;

// The answer of a use case of a curator; a handler or a page maps it.
export type ReportOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "invalid"; errors: readonly string[] }>
  | Readonly<{ status: "conflict"; reason: DecisionRefusal }>;
