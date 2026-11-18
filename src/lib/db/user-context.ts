import "server-only";

import type { EntityManager } from "@mikro-orm/postgresql";
import { z } from "zod";

import { getOrm } from "@/lib/db/client";

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
  return em.transactional(async (tx) => {
    await tx.execute("select set_config('app.user_id', ?, true)", [actor.id], "get");

    return work({ em: tx });
  });
}

// Public reads for a guest (D-T4): a read-only transaction on krajozbior_app
// with no `app.user_id`, so app_current_user_id() is NULL. Public policies
// (published collection of an approved organization) match without an actor,
// private ones match nothing. There is no read path that skips row security.
export async function runInGuestContext<T>(
  em: EntityManager,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  if (em.isInTransaction()) {
    throw new NestedUserContextError();
  }

  return em.transactional(async (tx) => {
    await tx.execute("set transaction read only", [], "run");

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
