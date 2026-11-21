import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getMyTheme, saveMyTheme } from "@/features/settings/application/settings";
import type { SettingsDeps } from "@/features/settings/application/settings-types";
import { THEMES } from "@/features/settings/domain/theme";
import { postgresSettingsRepository } from "@/features/settings/infrastructure/postgres-settings-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E9-4: `account_settings` (the theme remembered on the account) and its use
// cases on the real database (docs/data-isolation.md, class PRIV: only the owner
// reads and writes the row). `app` is a pooled connection as krajozbior_app (max
// 1 connection, so a leaked context would show). Raw SQL proves the policies and
// the grants; the use cases prove the same promises through the code the theme
// action and the sign-in routes call.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = { ...newUser("settings-a"), role: "user" as const };
const explorerB = { ...newUser("settings-b"), role: "user" as const };
const curator = { ...newUser("settings-curator"), role: "user" as const };
const administrator = { ...newUser("settings-admin"), role: "admin" as const };

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = f;

const deps = (): SettingsDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  repository: postgresSettingsRepository,
});

const rowsOf = (userId: string) =>
  admin$<Record<string, unknown>>(`select * from public.account_settings where user_id = $1`, [
    userId,
  ]);

describe("the settings of the account", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_account_settings");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curator, administrator]);
    await f.newOrganization("Gmina Ustawienia", "gmina-ustawienia", [curator]);
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
        ...(await findRowLevelSecurityGaps(client, ["public.account_settings"])),
        ...(await findApplicationRoleGaps(client)),
      ]);

      expect(gaps).toEqual([]);
    });

    it("gives krajozbior_app exactly select, insert of the theme and update of the theme and its time; no other role anything", async () => {
      const [p] = await admin$<Record<string, boolean>>(
        `select
           has_table_privilege('krajozbior_app', 'public.account_settings', 'select') as app_select,
           has_table_privilege('krajozbior_app', 'public.account_settings', 'delete, truncate, references, trigger') as app_bad,
           has_table_privilege('krajozbior_app', 'public.account_settings', 'insert, update') as app_whole_table,
           has_any_column_privilege('krajozbior_auth', 'public.account_settings', 'select, insert, update, references') as auth_any,
           has_any_column_privilege('krajozbior_ops', 'public.account_settings', 'select, insert, update, references') as ops_any,
           has_table_privilege('krajozbior_auth', 'public.account_settings', 'delete, truncate') as auth_delete,
           has_table_privilege('krajozbior_ops', 'public.account_settings', 'delete, truncate') as ops_delete`,
      );

      expect(p).toEqual({
        app_select: true,
        app_bad: false,
        app_whole_table: false,
        auth_any: false,
        ops_any: false,
        auth_delete: false,
        ops_delete: false,
      });

      for (const [privilege, allowed] of [
        ["insert", ["theme"]],
        ["update", ["theme", "updated_at"]],
      ] as const) {
        const columns = await admin$<{ column_name: string; ok: boolean }>(
          `select column_name,
                  has_column_privilege('krajozbior_app', 'public.account_settings', column_name, $1) as ok
             from information_schema.columns
            where table_schema = 'public' and table_name = 'account_settings'`,
          [privilege],
        );

        expect(
          columns
            .filter(({ ok }) => ok)
            .map(({ column_name }) => column_name)
            .sort(),
          privilege,
        ).toEqual([...allowed].sort());
      }
    });

    it("keeps the frozen theme list of the CHECK equal to the themes of the domain", async () => {
      const [{ definition }] = await admin$<{ definition: string }>(
        `select pg_get_constraintdef(c.oid) as definition
           from pg_constraint c
          where c.conrelid = 'public.account_settings'::regclass and c.contype = 'c'`,
      );
      const inCheck = [...definition.matchAll(/'([a-z_]+)'::text/g)].map(([, theme]) => theme);

      expect([...inCheck].sort()).toEqual([...THEMES].sort());
    });

    it("refuses an unknown theme and takes a valid one", async () => {
      await expect(
        as(explorerA, `insert into public.account_settings (theme) values ('neon')`),
      ).rejects.toThrow(/violates check constraint/);
      expect(await rowsOf(explorerA.id)).toEqual([]);
    });
  });

  describe("the use cases", () => {
    it("gives no theme before the first choice and does not create a row by reading", async () => {
      expect(await getMyTheme(explorerA, deps())).toEqual({ status: "ok", value: null });
      expect(await rowsOf(explorerA.id)).toEqual([]);
    });

    it("saves, reads back, and replaces the same row on the next choice", async () => {
      expect(await saveMyTheme(explorerA, "light", deps())).toEqual({
        status: "ok",
        value: "light",
      });
      expect(await getMyTheme(explorerA, deps())).toEqual({ status: "ok", value: "light" });

      const [first] = await rowsOf(explorerA.id);

      await saveMyTheme(explorerA, "dark", deps());

      const rows = await rowsOf(explorerA.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ user_id: explorerA.id, theme: "dark" });
      expect((rows[0]!.updated_at as Date).getTime()).toBeGreaterThan(
        (first!.updated_at as Date).getTime(),
      );
    });

    it("skips the write when the value does not change", async () => {
      await saveMyTheme(explorerA, "dark", deps());

      const [before] = await rowsOf(explorerA.id);

      await saveMyTheme(explorerA, "dark", deps());

      const [after] = await rowsOf(explorerA.id);

      expect(after!.updated_at).toEqual(before!.updated_at);
    });

    it("answers invalid without writing, and a guest is refused before the database", async () => {
      expect(await saveMyTheme(explorerB, "neon", deps())).toEqual({ status: "invalid" });
      expect(await saveMyTheme(null, "light", deps())).toEqual({ status: "unauthenticated" });
      expect(await getMyTheme(null, deps())).toEqual({ status: "unauthenticated" });
      expect(await rowsOf(explorerB.id)).toEqual([]);
    });
  });

  describe("explorer A against explorer B, a curator, an administrator and a guest", () => {
    it("keeps the theme of A from B: not read, not changed, not removed, not inserted for A, also with raw SQL", async () => {
      await saveMyTheme(explorerA, "light", deps());

      expect(await getMyTheme(explorerB, deps())).toEqual({ status: "ok", value: null });
      expect(await as(explorerB, `select * from public.account_settings`)).toEqual([]);
      expect(
        await as(explorerB, `select * from public.account_settings where user_id = ?`, [
          explorerA.id,
        ]),
      ).toEqual([]);
      // B updates nothing of A: no row matches B, and there is no DELETE grant at all.
      expect(
        await as(
          explorerB,
          `update public.account_settings set theme = 'dark' where user_id = ? returning *`,
          [explorerA.id],
        ),
      ).toEqual([]);
      expect(
        await as(explorerB, `update public.account_settings set theme = 'dark' returning *`),
      ).toEqual([]);
      await expect(
        as(explorerB, `delete from public.account_settings where user_id = ?`, [explorerA.id]),
      ).rejects.toThrow(/permission denied/);
      // B cannot even name an owner: the INSERT privilege does not cover `user_id` (42501).
      await expect(
        as(explorerB, `insert into public.account_settings (user_id, theme) values (?, 'dark')`, [
          explorerA.id,
        ]),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(
          explorerB,
          `update public.account_settings set user_id = ? where user_id = app_current_user_id()`,
          [explorerA.id],
        ),
      ).rejects.toThrow(/permission denied/);

      expect((await rowsOf(explorerA.id))[0]).toMatchObject({ theme: "light" });
    });

    it("lets B save a theme of their own over the same statement, leaving the row of A untouched", async () => {
      await saveMyTheme(explorerA, "light", deps());

      expect(await saveMyTheme(explorerB, "dark", deps())).toEqual({ status: "ok", value: "dark" });
      expect(await saveMyTheme(explorerB, "light", deps())).toEqual({
        status: "ok",
        value: "light",
      });
      await saveMyTheme(explorerB, "dark", deps());
      expect(await getMyTheme(explorerA, deps())).toEqual({ status: "ok", value: "light" });
      expect(await getMyTheme(explorerB, deps())).toEqual({ status: "ok", value: "dark" });
      expect(await rowsOf(explorerB.id)).toHaveLength(1);
    });

    it("does not show the theme to a curator or an administrator (roles do not inherit)", async () => {
      await saveMyTheme(explorerA, "light", deps());

      for (const other of [curator, administrator]) {
        expect(await getMyTheme(other, deps())).toEqual({ status: "ok", value: null });
        expect(await as(other, `select * from public.account_settings`)).toEqual([]);
        expect(
          await as(other, `update public.account_settings set theme = 'dark' returning *`),
        ).toEqual([]);
        await expect(
          as(other, `delete from public.account_settings where user_id = ?`, [explorerA.id]),
        ).rejects.toThrow(/permission denied/);
      }

      expect((await rowsOf(explorerA.id))[0]).toMatchObject({ theme: "light" });
    });

    it("gives a guest and a connection without a context no rows and refuses their writes", async () => {
      expect(await asGuest(`select * from public.account_settings`)).toEqual([]);
      await expect(
        asGuest(`insert into public.account_settings (theme) values ('light')`),
        // The guest context is a read-only transaction: the write is refused before any policy.
      ).rejects.toThrow(/read-only transaction/);
      expect(await app.em.execute(`select * from public.account_settings`)).toEqual([]);
      await expect(
        app.em.execute(`insert into public.account_settings (theme) values ('light')`),
      ).rejects.toThrow();
    });

    it("does not carry the actor over to the next transaction on the same connection", async () => {
      await saveMyTheme(explorerA, "light", deps());

      // B has a row of their own by now, so B sees exactly that one and nothing of A.
      expect(await as(explorerB, `select user_id from public.account_settings`)).toEqual([
        { user_id: explorerB.id },
      ]);
      expect(await asGuest(`select * from public.account_settings`)).toEqual([]);
    });
  });

  describe("deletion of the account", () => {
    it("removes the settings with the account by cascade", async () => {
      const gone = { ...newUser("settings-gone"), role: "user" as const };

      await f.insertUsers([gone]);
      await saveMyTheme(gone, "light", deps());
      expect(await rowsOf(gone.id)).toHaveLength(1);

      await admin$(`delete from auth.users where id = $1`, [gone.id]);

      expect(await rowsOf(gone.id)).toEqual([]);
    });
  });
});
