import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// D-E9-4: nothing about a person may survive the deletion of the account by
// accident. This test reads the catalog of the migrated database:
//
// 1. every foreign key that points at `auth.users` is listed below with its
//    behaviour and the reason; one with another behaviour than `cascade` or
//    `set null`, or one that is not listed, fails;
// 2. every uuid column outside the `auth` schema whose name says "a person"
//    (`user_id`, `*_user_id`, `*author*`, `*actor*`, `*owner*`, `*member*`) and
//    that has no foreign key to `auth.users` must be on the second list, with
//    the reason it may outlive the account.
//
// A later epic that adds a table of personal data adds its row here in the same
// pull request (the spec of E9 names E9-2 `profiles`, E9-4 `account_settings`).
// The heuristic is a safety net, not a proof: the skill `private-data` and the
// review of the migration stay the main protection.
type Behaviour = "cascade" | "set null";

const foreignKeys: Record<string, { behaviour: Behaviour; why: string }> = {
  "auth.sessions.user_id": { behaviour: "cascade", why: "the sessions of the account end with it" },
  "auth.accounts.user_id": { behaviour: "cascade", why: "the login credentials go with it" },
  "public.organization_members.user_id": {
    behaviour: "cascade",
    why: "the membership goes; the organization and its content stay (Q8)",
  },
  "public.saved_collections.user_id": { behaviour: "cascade", why: "private list of the explorer" },
  "public.visits.user_id": { behaviour: "cascade", why: "private visits of the explorer" },
  "public.want_to_see_places.user_id": {
    behaviour: "cascade",
    why: "private list of the explorer",
  },
};

const columnsWithoutForeignKey: Record<string, string> = {
  "public.operations_audit.subject_user_id":
    "the audit is append-only and keeps the bare account id, never an address or a name (Q9, D-20, D-21)",
};

const NAME_PATTERN = "(^user_id$|_user_id$|author|actor|owner|member)";

let db: ScratchDatabase;

const query = <T>(sql: string) =>
  withClient(db.adminUrl, async (client) => (await client.query(sql)).rows as T[]);

describe("every trace of an account is accounted for (D-E9-4)", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_account_coverage");
    await db.migrate();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("lists every foreign key to auth.users with cascade or set null", async () => {
    const rows = await query<{ column: string; type: string }>(
      `select n.nspname || '.' || r.relname || '.' || a.attname as "column", c.confdeltype as type
         from pg_constraint c
         join pg_class r on r.oid = c.conrelid
         join pg_namespace n on n.oid = r.relnamespace
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
        order by 1`,
    );
    const behaviourOf: Record<string, Behaviour | "other"> = Object.fromEntries(
      rows.map(({ column, type }) => [
        column,
        type === "c" ? "cascade" : type === "n" ? "set null" : "other",
      ]),
    );

    expect(Object.keys(behaviourOf).sort()).toEqual(Object.keys(foreignKeys).sort());
    for (const [column, { behaviour }] of Object.entries(foreignKeys)) {
      expect(behaviourOf[column], column).toBe(behaviour);
    }
  });

  it("lists every column of a person that has no foreign key to auth.users, with the reason", async () => {
    const rows = await query<{ column: string }>(
      `select n.nspname || '.' || r.relname || '.' || a.attname as "column"
         from pg_attribute a
         join pg_class r on r.oid = a.attrelid and r.relkind in ('r', 'p')
         join pg_namespace n on n.oid = r.relnamespace
        where n.nspname not in ('auth', 'pg_catalog', 'information_schema')
          and a.attnum > 0 and not a.attisdropped
          and a.atttypid = 'uuid'::regtype
          and a.attname ~ '${NAME_PATTERN}'
          and not exists (
            select from pg_constraint c
             where c.contype = 'f' and c.conrelid = a.attrelid and a.attnum = any(c.conkey)
               and c.confrelid = 'auth.users'::regclass
          )
        order by 1`,
    );

    expect(rows.map(({ column }) => column)).toEqual(Object.keys(columnsWithoutForeignKey).sort());
  });
});
