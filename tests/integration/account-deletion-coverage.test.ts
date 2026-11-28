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
  "public.profiles.user_id": {
    behaviour: "cascade",
    why: "profile of the explorer: name, initial, region, visibility (E9-2)",
  },
  "public.account_settings.user_id": {
    behaviour: "cascade",
    why: "settings remembered on the account: the theme (E9-4)",
  },
  "public.terms_acceptance.user_id": {
    behaviour: "cascade",
    why: "which version of the terms the account accepted and when; evidence for the account only (F-K3)",
  },
  "public.place_photos.created_by": {
    behaviour: "set null",
    why: "who of the team filed the rights statement of an official photo; the photo and its signature stay without the person (E4-2a, spec 5.1)",
  },
  "public.place_reports.author_id": {
    behaviour: "set null",
    why: "who reported a problem with a place; the report stays without the person; the text of the report stays too until PR B (cleanup on account deletion: an open report goes with the account, a decided one loses its text; P4b, spec 5.1 and DT-P4b-5)",
  },
  "public.place_reports.decided_by": {
    behaviour: "set null",
    why: "which curator decided; never read by the author, and the report stays when the curator leaves (P4b, spec 5.1)",
  },
  "public.organization_members.user_id": {
    behaviour: "cascade",
    why: "the membership goes; the organization and its content stay (Q8)",
  },
  "public.user_collections.owner_user_id": {
    behaviour: "cascade",
    why: "own collections of the explorer, private; their entries go with them (E8-1a, E8-Q6)",
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

const NAME_PATTERN = "(^user_id$|_user_id$|author|actor|owner|member|_by$)";

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
