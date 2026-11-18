import { randomBytes } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { Client, type Pool } from "pg";

import { createOrmConfig } from "@/lib/db/config";
import { databaseRoles, provisionDatabaseRoles, type DatabaseRole } from "@/lib/db/roles";
import { parseIntegrationDatabaseUrl } from "./integration-database-url";

// Integration tests run on their own scratch database, created from the
// TEST_DATABASE_URL superuser connection, so they do not depend on file order.
// The superuser only prepares the database and inspects it; every claim about
// access is checked through a real LOGIN connection of the role (issue #21).
export type ScratchDatabase = {
  /** Superuser connection to the scratch database, for setup and catalog checks only. */
  adminUrl: string;
  urls: Record<DatabaseRole, string>;
  /** Runs the `npm run db:roles` logic again on this database. */
  provisionRoles(): Promise<void>;
  /** Runs all migrations as krajozbior_owner, like `npm run db:migrate`. */
  migrate(): Promise<void>;
  drop(): Promise<void>;
};

// Roles are global to the cluster, so the whole test process shares one set of
// passwords; files run one after another (fileParallelism: false).
const passwords = Object.fromEntries(
  databaseRoles.map((role) => [role, randomBytes(24).toString("base64url")]),
) as Record<DatabaseRole, string>;

function urlFor(base: string, database: string, user?: DatabaseRole): string {
  const url = new URL(base);

  url.pathname = `/${database}`;
  if (user !== undefined) {
    url.username = user;
    url.password = passwords[user];
  }

  return url.toString();
}

export async function withClient<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });

  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

// `pool.end()` resolves once the clients are detached, before their sockets
// close. Dropping the database `with (force)` right after it can then
// terminate a still-open connection (57P01), which surfaces as an unhandled
// error and fails the run. Wait for every client's `remove` event instead.
export async function closePool(pool: Pool): Promise<void> {
  const open = pool.totalCount;
  const closed = new Promise<void>((resolve) => {
    let removed = 0;

    if (open === 0) {
      resolve();
    }
    pool.on("remove", () => {
      removed += 1;
      if (removed >= open) {
        resolve();
      }
    });
  });

  await pool.end();
  await closed;
}

export async function createScratchDatabase(name: string): Promise<ScratchDatabase> {
  if (!/^krajozbior_integration_[a-z_]+$/.test(name)) {
    throw new Error("Scratch database names must start with krajozbior_integration_");
  }

  const testUrl = parseIntegrationDatabaseUrl(process.env.TEST_DATABASE_URL);
  const adminUrl = urlFor(testUrl, name);

  await withClient(testUrl, async (client) => {
    await client.query(`drop database if exists ${name} with (force)`);
    await client.query(`create database ${name}`);
  });
  const provisionRoles = () =>
    withClient(adminUrl, (client) => provisionDatabaseRoles(client, passwords));

  await provisionRoles();

  const urls = Object.fromEntries(
    databaseRoles.map((role) => [role, urlFor(testUrl, name, role)]),
  ) as Record<DatabaseRole, string>;

  return {
    adminUrl,
    urls,
    provisionRoles,
    async migrate() {
      const orm = await MikroORM.init(createOrmConfig(urls.krajozbior_owner));

      try {
        await orm.migrator.up();
      } finally {
        await orm.close(true);
      }
    },
    async drop() {
      await withClient(testUrl, (client) =>
        client.query(`drop database if exists ${name} with (force)`),
      );
    },
  };
}
