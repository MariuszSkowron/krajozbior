import "server-only";

import type { EntityManager } from "@mikro-orm/postgresql";
import { z } from "zod";

import { getOrm } from "@/lib/db/client";
import { withoutQueryText } from "@/lib/db/database-error";

// The only way domain code reaches private data (issue #21,
// docs/data-isolation.md section 4). Row policies read app_current_user_id(),
// which is NULL until this wrapper sets `app.user_id` for one transaction.
// The setting is transaction-local (set_config(..., true)), so a pooled
// connection never carries one user's identity into another request.

/** The signed-in actor from the identity provider; only its id is used here. */
export type ContextActor = Readonly<{ id: string }>;

/** What `work` gets: the transactional entity manager, never the global one. */
export type TransactionContext = Readonly<{ em: EntityManager }>;

// Raised for an actor id that is not a UUID. That is a server bug, not a
// guest: the wrapper must not run the work with an empty context instead.
export class InvalidActorIdError extends Error {
  constructor() {
    super("Actor id must be a UUID");
    this.name = "InvalidActorIdError";
  }
}

// Raised when the wrapper is called inside an open transaction (issue #42).
// MikroORM would open a savepoint there, and set_config(..., true) lasts until
// the outer transaction ends, so the inner actor would replace the outer one.
export class NestedUserContextError extends Error {
  constructor() {
    super("User context cannot be opened inside another transaction");
    this.name = "NestedUserContextError";
  }
}

const actorIdSchema = z.uuid();

export async function runInUserContext<T>(
  em: EntityManager,
  actor: ContextActor,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  if (!actorIdSchema.safeParse(actor.id).success) {
    throw new InvalidActorIdError();
  }
  if (em.isInTransaction()) {
    throw new NestedUserContextError();
  }

  // Any error, including one from set_config, rolls back the whole transaction.
  return transactionWithoutQueryText(em, async (tx) => {
    await tx.execute("select set_config('app.user_id', ?, true)", [actor.id], "get");

    return work({ em: tx });
  });
}

// Raised for a session token that cannot be a Better Auth token (empty, too long, control
// characters). Like every error of the admin context it never carries the token.
export class InvalidSessionTokenError extends Error {
  constructor() {
    super("Session token is not usable");
    this.name = "InvalidSessionTokenError";
  }
}

// Raised when the database refuses to take the session token. The original error is dropped on
// purpose: the driver's message repeats the statement with its values (the secret token).
export class AdminContextError extends Error {
  constructor() {
    super("Admin context could not be opened");
    this.name = "AdminContextError";
  }
}

const SESSION_TOKEN_MAX_LENGTH = 512;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

// The context of an administrator (spec "Rola kuratora", D-59): the same as `runInUserContext`
// plus `app.session_token`, the token of the live session of the actor, for this transaction
// only (set_config(..., true)). The functions of the administrator in the database compare it
// with `auth.sessions` (`app_require_live_admin`), so an identifier alone is not enough. The
// token comes from the session of the request (`IdentityProvider.getActorWithSession`), is
// never logged, and never appears in an error of this wrapper.
export async function runInAdminContext<T>(
  em: EntityManager,
  actor: ContextActor,
  sessionToken: string,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  if (!actorIdSchema.safeParse(actor.id).success) {
    throw new InvalidActorIdError();
  }
  if (
    sessionToken.length < 1 ||
    sessionToken.length > SESSION_TOKEN_MAX_LENGTH ||
    CONTROL_CHARACTERS.test(sessionToken)
  ) {
    throw new InvalidSessionTokenError();
  }
  if (em.isInTransaction()) {
    throw new NestedUserContextError();
  }

  return transactionWithoutQueryText(em, async (tx) => {
    await tx.execute("select set_config('app.user_id', ?, true)", [actor.id], "get");
    try {
      await tx.execute("select set_config('app.session_token', ?, true)", [sessionToken], "get");
    } catch {
      throw new AdminContextError();
    }

    return work({ em: tx });
  });
}

// A database error leaves the context without the values that PostgreSQL repeats in its message
// and fields (see `database-error.ts`; outside the context read only `code` and `constraint`);
// other errors pass on unchanged.
async function transactionWithoutQueryText<T>(
  em: EntityManager,
  work: (tx: EntityManager) => Promise<T>,
): Promise<T> {
  try {
    return await em.transactional(work);
  } catch (error) {
    throw withoutQueryText(error);
  }
}

// Public reads for a guest (D-T4): a read-only transaction on krajozbior_app
// with `app.user_id` cleared for the transaction, so app_current_user_id() is
// NULL even on a connection that someone left with a session-level user
// (defence in depth: today nothing sets it for a session). Public policies
// (published collection of an approved organization) match without an actor,
// private ones match nothing. There is no read path that skips row security.
export async function runInGuestContext<T>(
  em: EntityManager,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  if (em.isInTransaction()) {
    throw new NestedUserContextError();
  }

  return transactionWithoutQueryText(em, async (tx) => {
    await tx.execute("set transaction read only", [], "run");
    await tx.execute("select set_config('app.user_id', '', true)", [], "get");

    return work({ em: tx });
  });
}

export async function withGuestContext<T>(
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const orm = await getOrm();

  return runInGuestContext(orm.em, work);
}

// Guests have no actor and never call withUserContext; use cases check the session and
// role first (requireActor/requireRole), then open the context.
export async function withUserContext<T>(
  actor: ContextActor,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const orm = await getOrm();

  return runInUserContext(orm.em, actor, work);
}

// Only for the use cases of the administrator, after the role check; see `runInAdminContext`.
export async function withAdminContext<T>(
  actor: ContextActor,
  sessionToken: string,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const orm = await getOrm();

  return runInAdminContext(orm.em, actor, sessionToken, work);
}
