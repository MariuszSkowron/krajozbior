import type { Actor } from "@/features/identity/domain/actor";
import type { TransactionContext } from "@/lib/db/user-context";

// What the use case needs from the outside. The real dependencies are in
// `infrastructure/delete-account-deps.ts`; the integration test passes the real
// database, the unit test passes fakes.
export type DeleteAccountDeps = Readonly<{
  withUserContext: <T>(
    actor: Pick<Actor, "id">,
    work: (tx: TransactionContext) => Promise<T>,
  ) => Promise<T>;
  /** True when the actor of the user context is the only member of some organization (Q8). */
  isSoleOrganizationMember: (tx: TransactionContext) => Promise<boolean>;
  /** Deletes the account of this id as the identity role; everything else follows from the database. */
  deleteAccount: (accountId: string) => Promise<void>;
  now: () => Date;
}>;

export type DeleteAccountOutcome =
  | Readonly<{ status: "deleted" }>
  | Readonly<{ status: "unauthenticated" }>
  | Readonly<{ status: "managed_account" }>
  | Readonly<{ status: "invalid_confirmation" }>
  | Readonly<{ status: "stale_session" }>;
