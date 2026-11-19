import "server-only";

import { randomInt } from "node:crypto";

import { Client } from "pg";

import { getOpsEnv, getServerEnv } from "@/lib/config/env";
import { initApplicationOrm } from "@/lib/db/client";
import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";

import { executeCatalogImport, executeCatalogRemove } from "../application/catalog-import";
import { assertSafeImportEnvironment } from "../application/catalog-import-safety";
import type { CatalogImportRunner } from "../application/catalog-import-command";
import type { CatalogImportDeps } from "../application/catalog-import-types";
import { postgresCatalogImportRepository } from "./postgres-catalog-import-repository";
import { postgresCatalogRepository } from "./postgres-catalog-repository";

// The connections of the loader: the account of the curator is found by
// e-mail through `ops_find_user` as krajozbior_ops (krajozbior_app cannot do
// that), the load itself runs as krajozbior_app (the role bound by row
// policies, never the owner of the tables) in the user context of the curator.
// The write limit of curators is off here (the same as in the demo seed): the
// loader is an operator command that runs locally, and a real limit would stop
// a load of about a hundred and seventy places. The guards below keep it local.

async function findCuratorId(opsUrl: string, email: string): Promise<string | undefined> {
  const ops = new Client({ connectionString: opsUrl });

  await ops.connect();

  try {
    return (
      await ops.query<{ user_id: string }>(`select user_id from public.ops_find_user($1)`, [email])
    ).rows[0]?.user_id;
  } finally {
    await ops.end();
  }
}

export async function connectCatalogImport(): Promise<CatalogImportRunner> {
  // Before any connection; the variables are read only afterwards.
  assertSafeImportEnvironment({
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_OPS_URL: process.env.DATABASE_OPS_URL,
  });

  const opsUrl = getOpsEnv().DATABASE_OPS_URL;
  const appUrl = getServerEnv().DATABASE_URL;
  const orm = await initApplicationOrm(createOrmConfig(appUrl));
  const deps: CatalogImportDeps = {
    catalog: {
      withUserContext: (actor, work) => runInUserContext(orm.em, actor, work),
      withGuestContext: (work) => runInGuestContext(orm.em, work),
      limiter: { reserve: async () => ({ allowed: true }) },
      repository: postgresCatalogRepository,
      random: (max) => randomInt(max),
    },
    imports: postgresCatalogImportRepository,
  };

  return {
    async run({ orgSlug, curatorEmail, file, preview, publish, remove }) {
      const curatorId = await findCuratorId(opsUrl, curatorEmail);

      if (curatorId === undefined) {
        return { kind: "refused", code: "curator_not_found" };
      }

      const actor = { id: curatorId, role: "user" } as const;

      return remove
        ? executeCatalogRemove({ actor, orgSlug, file }, deps)
        : executeCatalogImport({ actor, orgSlug, file, preview, publish }, deps);
    },
    close: () => orm.close(true),
  };
}
