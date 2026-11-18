import "server-only";

import { MikroORM, type Options } from "@mikro-orm/postgresql";

import { createOrmConfig } from "@/lib/db/config";
import {
  assertSafeDatabaseRole,
  type RoleFlags,
  UnsafeDatabaseRoleError,
} from "@/lib/db/role-guard";

export { UnsafeDatabaseRoleError };

// The application must run as krajozbior_app (docs/data-isolation.md, section 3);
// with a role that can skip row policies every private table would be readable.
export async function initApplicationOrm(options: Options = createOrmConfig()): Promise<MikroORM> {
  const orm = await MikroORM.init(options);

  try {
    await assertSafeDatabaseRole((sql) => orm.em.execute<Partial<RoleFlags>>(sql, [], "get"));
  } catch (error) {
    // A failure while closing must not hide why the connection was refused.
    await orm.close(true).catch(() => undefined);
    throw error;
  }

  return orm;
}

let ormPromise: Promise<MikroORM> | undefined;

// One ORM instance per server process. A failed init is not cached, so the next
// request retries instead of reusing a broken connection setup. A refused role
// is cached: only a restart with a different DATABASE_URL can fix it.
export function getOrm(): Promise<MikroORM> {
  ormPromise ??= initApplicationOrm().catch((error: unknown) => {
    if (error instanceof UnsafeDatabaseRoleError) {
      console.error("Database connection refused:", error.name);
    } else {
      ormPromise = undefined;
    }
    throw error;
  });

  return ormPromise;
}
