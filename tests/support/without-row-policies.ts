import { MikroORM } from "@mikro-orm/postgresql";

import { createOrmConfig } from "@/lib/db/config";
import type { TransactionContext } from "@/lib/db/user-context";

// Proof of the SECOND barrier. Row policies hide other people's rows, so a
// test through the normal connection cannot tell whether a query still has its
// own `user_id = app_current_user_id()` filter. Here the same work runs as the
// krajozbior_app role with the row policies of the named tables switched off, in a
// transaction that is always rolled back. If a filter is removed from the SQL,
// the other person's rows show up and the test fails.
class Rollback extends Error {}

export async function withoutRowPolicies<T>(
  adminUrl: string,
  tables: readonly string[],
  actorId: string,
  work: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const orm = await MikroORM.init({ ...createOrmConfig(adminUrl), pool: { min: 1, max: 1 } });
  let result: { value: T } | undefined;

  try {
    await orm.em
      .transactional(async (em) => {
        for (const table of tables) {
          await em.execute(`alter table public.${table} disable row level security`);
        }
        await em.execute("set local role krajozbior_app");
        await em.execute("select set_config('app.user_id', ?, true)", [actorId], "get");
        result = { value: await work({ em }) };

        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) {
          throw error;
        }
      });
  } finally {
    await orm.close(true);
  }

  if (result === undefined) {
    throw new Error("The work did not finish");
  }

  return result.value;
}
