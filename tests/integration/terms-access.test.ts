import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { acceptCurrentTerms, hasAcceptedCurrentTerms } from "@/features/terms/application/terms";
import type { TermsDeps } from "@/features/terms/application/terms-types";
import { CURRENT_TERMS_VERSION } from "@/features/terms/domain/terms-version";
import { postgresTermsRepository } from "@/features/terms/infrastructure/postgres-terms-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// F-K3: `terms_acceptance` and its use cases on the real database (docs/data-isolation.md,
// class PRIV: only the owner of the account reads and adds a row; the row is never changed
// or removed by the application and goes with the account). `app` is a pooled connection as
// krajozbior_app (one connection, so a leaked context would show). Raw SQL proves the policies
// and the grants; the use cases prove the same promises through the code the route calls.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = { ...newUser("terms-a"), role: "user" as const };
const explorerB = { ...newUser("terms-b"), role: "user" as const };
const curator = { ...newUser("terms-curator"), role: "user" as const };
const administrator = { ...newUser("terms-admin"), role: "admin" as const };

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = f;

const deps = (): TermsDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  repository: postgresTermsRepository,
});

const rowsOf = (userId: string) =>
  admin$<Record<string, unknown>>(`select * from public.terms_acceptance where user_id = $1`, [
    userId,
  ]);

const acceptRaw = (actor: { id: string }, version: string) =>
  as(actor, `insert into public.terms_acceptance (terms_version) values (?)`, [version]);

describe("the acceptance of the terms", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_terms");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curator, administrator]);
    await f.newOrganization("Gmina Regulamin", "gmina-regulamin", [curator]);
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  describe("the table", () => {
    it("has row security enabled, forced and policies, and a safe app role", async () => {
      const gaps = await withClient(db.adminUrl, async (client) => [
        ...(await findRowLevelSecurityGaps(client, ["public.terms_acceptance"])),
        ...(await findApplicationRoleGaps(client)),
      ]);

      expect(gaps).toEqual([]);
    });

    it("gives krajozbior_app exactly select and insert of the version column; no other role anything", async () => {
      const [p] = await admin$<Record<string, boolean>>(
        `select
           has_table_privilege('krajozbior_app', 'public.terms_acceptance', 'select') as app_select,
           has_table_privilege('krajozbior_app', 'public.terms_acceptance', 'update, delete, truncate, references, trigger') as app_bad,
           has_table_privilege('krajozbior_app', 'public.terms_acceptance', 'insert') as app_whole_insert,
           has_any_column_privilege('krajozbior_app', 'public.terms_acceptance', 'update') as app_any_update,
           has_any_column_privilege('krajozbior_auth', 'public.terms_acceptance', 'select, insert, update, references') as auth_any,
           has_any_column_privilege('krajozbior_ops', 'public.terms_acceptance', 'select, insert, update, references') as ops_any`,
      );

      expect(p).toEqual({
        app_select: true,
        app_bad: false,
        app_whole_insert: false,
        app_any_update: false,
        auth_any: false,
        ops_any: false,
      });

      const columns = await admin$<{ column_name: string; ok: boolean }>(
        `select column_name,
                has_column_privilege('krajozbior_app', 'public.terms_acceptance', column_name, 'insert') as ok
           from information_schema.columns
          where table_schema = 'public' and table_name = 'terms_acceptance'`,
      );

      expect(columns.filter(({ ok }) => ok).map(({ column_name }) => column_name)).toEqual([
        "terms_version",
      ]);
    });

    it("refuses a version of the wrong shape and a second row for the same version", async () => {
      for (const version of ["", "v1", "0.", "1.2.3.4.5", "0.2 "]) {
        await expect(acceptRaw(explorerA, version), version).rejects.toThrow(
          /violates check constraint/,
        );
      }

      await acceptRaw(explorerA, "0.1");
      await expect(acceptRaw(explorerA, "0.1")).rejects.toThrow(/duplicate key/);
      await admin$(`delete from public.terms_acceptance where user_id = $1`, [explorerA.id]);
    });

    it("removes the rows with the account", async () => {
      await acceptRaw(explorerB, "0.9");
      expect(await rowsOf(explorerB.id)).toHaveLength(1);

      const [{ id }] = await admin$<{ id: string }>(
        `insert into auth.users (id, name, email) values (gen_random_uuid(), 'tmp', 'terms-tmp@example.com') returning id`,
      );
      await as({ id }, `insert into public.terms_acceptance (terms_version) values ('0.1')`);
      await admin$(`delete from auth.users where id = $1`, [id]);

      expect(await rowsOf(id)).toEqual([]);
      await admin$(`delete from public.terms_acceptance where user_id = $1`, [explorerB.id]);
    });
  });

  describe("the use cases", () => {
    it("starts without the acceptance, records the current version once and reads it back", async () => {
      expect(await hasAcceptedCurrentTerms(explorerA, deps())).toEqual({
        status: "ok",
        value: false,
      });
      expect(await acceptCurrentTerms(explorerA, "on", deps())).toEqual({
        status: "ok",
        value: null,
      });
      expect(await hasAcceptedCurrentTerms(explorerA, deps())).toEqual({
        status: "ok",
        value: true,
      });

      const [first] = await rowsOf(explorerA.id);

      expect(first).toMatchObject({ user_id: explorerA.id, terms_version: CURRENT_TERMS_VERSION });
      expect(first!.accepted_at).toBeInstanceOf(Date);

      // A second acceptance of the same version is not an error and changes nothing.
      expect(await acceptCurrentTerms(explorerA, "on", deps())).toEqual({
        status: "ok",
        value: null,
      });

      const rows = await rowsOf(explorerA.id);

      expect(rows).toHaveLength(1);
      expect((rows[0]!.accepted_at as Date).getTime()).toBe((first!.accepted_at as Date).getTime());
    });

    it("counts only the current version: an older acceptance does not pass the screen", async () => {
      await acceptRaw(explorerB, "0.1");

      expect(await hasAcceptedCurrentTerms(explorerB, deps())).toEqual({
        status: "ok",
        value: false,
      });

      await admin$(`delete from public.terms_acceptance where user_id = $1`, [explorerB.id]);
    });

    it("writes nothing without the checked box, and a guest is refused before the database", async () => {
      expect(await acceptCurrentTerms(explorerB, undefined, deps())).toEqual({ status: "invalid" });
      expect(await acceptCurrentTerms(explorerB, "off", deps())).toEqual({ status: "invalid" });
      expect(await acceptCurrentTerms(null, "on", deps())).toEqual({ status: "unauthenticated" });
      expect(await hasAcceptedCurrentTerms(null, deps())).toEqual({ status: "unauthenticated" });
      expect(await rowsOf(explorerB.id)).toEqual([]);
    });
  });

  describe("explorer A against explorer B, a curator, an administrator and a guest", () => {
    it("keeps the acceptance of A from B: not read, not changed, not removed, not inserted for A, also with raw SQL", async () => {
      await acceptCurrentTerms(explorerA, "on", deps());

      // B does not pass the screen on the strength of the row of A.
      expect(await hasAcceptedCurrentTerms(explorerB, deps())).toEqual({
        status: "ok",
        value: false,
      });
      expect(await as(explorerB, `select * from public.terms_acceptance`)).toEqual([]);
      expect(
        await as(explorerB, `select * from public.terms_acceptance where user_id = ?`, [
          explorerA.id,
        ]),
      ).toEqual([]);
      // No UPDATE or DELETE grant at all: the row is evidence and the application cannot touch it.
      await expect(
        as(explorerB, `update public.terms_acceptance set terms_version = '9.9'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(explorerA, `update public.terms_acceptance set terms_version = '9.9'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(explorerA, `delete from public.terms_acceptance where user_id = app_current_user_id()`),
      ).rejects.toThrow(/permission denied/);
      // B cannot even name an owner: the INSERT privilege does not cover `user_id` (42501).
      await expect(
        as(
          explorerB,
          `insert into public.terms_acceptance (user_id, terms_version) values (?, '0.5')`,
          [explorerA.id],
        ),
      ).rejects.toThrow(/permission denied/);
      // Nor the time of the acceptance.
      await expect(
        as(
          explorerB,
          `insert into public.terms_acceptance (terms_version, accepted_at) values ('0.5', now())`,
        ),
      ).rejects.toThrow(/permission denied/);

      expect(await rowsOf(explorerA.id)).toHaveLength(1);
      expect(await rowsOf(explorerB.id)).toEqual([]);
    });

    it("does not show the acceptance to a curator or an administrator (roles do not inherit)", async () => {
      await acceptCurrentTerms(explorerA, "on", deps());
      await acceptCurrentTerms(explorerB, "on", deps());

      for (const actor of [curator, administrator]) {
        expect(await as(actor, `select * from public.terms_acceptance`), actor.email).toEqual([]);
        expect(await hasAcceptedCurrentTerms(actor, deps()), actor.email).toEqual({
          status: "ok",
          value: false,
        });
        await expect(
          as(
            actor,
            `insert into public.terms_acceptance (user_id, terms_version) values (?, '0.5')`,
            [explorerA.id],
          ),
        ).rejects.toThrow(/permission denied/);
      }

      // Each account accepts only for itself.
      await acceptCurrentTerms(curator, "on", deps());
      expect(await rowsOf(curator.id)).toHaveLength(1);
      expect(await rowsOf(administrator.id)).toEqual([]);
    });

    it("shows a guest and a connection without a context no rows and refuses their writes", async () => {
      expect(await asGuest(`select * from public.terms_acceptance`)).toEqual([]);
      await expect(
        asGuest(`insert into public.terms_acceptance (terms_version) values ('0.7')`),
      ).rejects.toThrow(/read-only transaction/);
      expect(await app.em.execute(`select * from public.terms_acceptance`)).toEqual([]);
      await expect(
        app.em.execute(`insert into public.terms_acceptance (terms_version) values ('0.7')`),
      ).rejects.toThrow();
      expect(
        await admin$(`select 1 from public.terms_acceptance where terms_version = '0.7'`),
      ).toEqual([]);
    });

    it("does not leak the context of one request into the next on the same connection", async () => {
      expect(await as(explorerA, `select terms_version from public.terms_acceptance`)).toEqual([
        { terms_version: CURRENT_TERMS_VERSION },
      ]);
      expect(
        await as(explorerB, `select * from public.terms_acceptance where user_id = ?`, [
          explorerA.id,
        ]),
      ).toEqual([]);
      expect(await app.em.execute(`select * from public.terms_acceptance`)).toEqual([]);
    });
  });

  describe("the other roles of the database", () => {
    it("binds the owner of the table by FORCE ROW LEVEL SECURITY: krajozbior_owner sees no row of anybody", async () => {
      await acceptCurrentTerms(explorerA, "on", deps());
      expect((await rowsOf(explorerA.id)).length).toBeGreaterThan(0);

      const seenByOwner = await withClient(
        db.urls.krajozbior_owner,
        async (client) => (await client.query(`select * from public.terms_acceptance`)).rows,
      );

      expect(seenByOwner).toEqual([]);
    });

    it("gives krajozbior_auth and krajozbior_ops no access to the table", async () => {
      for (const url of [db.urls.krajozbior_auth, db.urls.krajozbior_ops]) {
        await withClient(url, async (client) => {
          await expect(client.query(`select * from public.terms_acceptance`)).rejects.toMatchObject(
            { code: "42501" },
          );
          await expect(
            client.query(
              `insert into public.terms_acceptance (user_id, terms_version) values ($1, '0.5')`,
              [explorerA.id],
            ),
          ).rejects.toMatchObject({ code: "42501" });
        });
      }
    });
  });
});
