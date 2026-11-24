import type { Actor } from "@/features/identity/domain/actor";
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

export type DecisionRefusal = "stale_version" | "author_gone" | "own_report" | "invalid_state";

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
}>;

export type ReportsDeps = Readonly<{
  withUserContext: <T>(actor: Actor, work: (tx: TransactionContext) => Promise<T>) => Promise<T>;
  repository: ReportsRepository;
}>;

// The answer of a use case of a curator; a handler or a page maps it.
export type ReportOutcome<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "invalid"; errors: readonly string[] }>
  | Readonly<{ status: "conflict"; reason: DecisionRefusal }>;
