import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REGIONS } from "@/features/catalog/domain/collection";
import { getMyProfile, saveMyProfile } from "@/features/profile/application/profile";
import type { ProfileDeps } from "@/features/profile/application/profile-types";
import { DEFAULT_PROFILE, type Profile } from "@/features/profile/domain/profile";
import { postgresProfileRepository } from "@/features/profile/infrastructure/postgres-profile-repository";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";
import { findApplicationRoleGaps, findRowLevelSecurityGaps } from "../support/rls-guard";

// E9-2: `profiles` and its use cases on the real database (docs/data-isolation.md,
// class "Prywatna z wyborem"; today only the owner reads and writes the row).
// `app` is a pooled connection as krajozbior_app (max 1 connection, so a leaked
// context would show). Raw SQL proves the policies and the grants; the use cases
// prove the same promises through the code the routes call.
let db: ScratchDatabase;
let app: MikroORM;

const explorerA = { ...newUser("profile-a"), role: "user" as const };
const explorerB = { ...newUser("profile-b"), role: "user" as const };
const curator = { ...newUser("profile-curator"), role: "user" as const };
const administrator = { ...newUser("profile-admin"), role: "admin" as const };

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = f;

const deps = (allowed = true): ProfileDeps => ({
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  limiter: {
    reserve: async () => (allowed ? { allowed: true } : { allowed: false, retryAfterSeconds: 30 }),
  },
  repository: postgresProfileRepository,
});

const annaK: Profile = {
  firstName: "Anna",
  familyInitial: "K",
  region: "pomorskie",
  visibility: "public",
};

// The profile as the form posts it.
const input = (profile: Profile) => ({ ...profile });

const insertRaw = (
  actor: { id: string },
  values: {
    first_name?: string | null;
    family_initial?: string | null;
    region?: string | null;
    visibility?: string;
  },
) =>
  as(
    actor,
    `insert into public.profiles (first_name, family_initial, region, visibility)
     values (?, ?, ?, ?)`,
    [
      values.first_name ?? null,
      values.family_initial ?? null,
      values.region ?? null,
      values.visibility ?? "private",
    ],
  );

const rowsOf = (userId: string) =>
  admin$<Record<string, unknown>>(`select * from public.profiles where user_id = $1`, [userId]);

describe("the profile", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_profile");
    await db.migrate();
    await f.insertUsers([explorerA, explorerB, curator, administrator]);
    await f.newOrganization("Gmina Profil", "gmina-profil", [curator]);
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
        ...(await findRowLevelSecurityGaps(client, ["public.profiles"])),
        ...(await findApplicationRoleGaps(client)),
      ]);

      expect(gaps).toEqual([]);
    });

    it("gives krajozbior_app exactly select, and insert and update only of the columns the explorer edits; no other role anything", async () => {
      const [p] = await admin$<Record<string, boolean>>(
        `select
           has_table_privilege('krajozbior_app', 'public.profiles', 'select') as app_select,
           has_table_privilege('krajozbior_app', 'public.profiles', 'delete, truncate, references, trigger') as app_bad,
           has_table_privilege('krajozbior_app', 'public.profiles', 'insert, update') as app_whole_table,
           has_any_column_privilege('krajozbior_auth', 'public.profiles', 'select, insert, update, references') as auth_any,
           has_any_column_privilege('krajozbior_ops', 'public.profiles', 'select, insert, update, references') as ops_any,
           has_table_privilege('krajozbior_auth', 'public.profiles', 'delete, truncate') as auth_delete,
           has_table_privilege('krajozbior_ops', 'public.profiles', 'delete, truncate') as ops_delete`,
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
        ["insert", ["first_name", "family_initial", "region", "visibility"]],
        ["update", ["first_name", "family_initial", "region", "visibility", "updated_at"]],
      ] as const) {
        const columns = await admin$<{ column_name: string; ok: boolean }>(
          `select column_name,
                  has_column_privilege('krajozbior_app', 'public.profiles', column_name, $1) as ok
             from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles'`,
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

    it("keeps the frozen region list of the CHECK equal to the regions of the domain", async () => {
      const [{ definition }] = await admin$<{ definition: string }>(
        `select pg_get_constraintdef(c.oid) as definition
           from pg_constraint c
          where c.conrelid = 'public.profiles'::regclass and c.contype = 'c'
            and pg_get_constraintdef(c.oid) like '%region%'`,
      );
      const inCheck = [...definition.matchAll(/'([a-z_]+)'::text/g)].map(([, region]) => region);

      expect([...inCheck].sort()).toEqual([...REGIONS].sort());
    });

    it("refuses what the CHECKs refuse, and takes a valid row", async () => {
      const bad: Record<string, Parameters<typeof insertRaw>[1]> = {
        "a control character in the name": { first_name: "An\nna" },
        "a name of 41 characters": { first_name: "A".repeat(41) },
        "a name with outer spaces": { first_name: " Anna" },
        "an empty name": { first_name: "" },
        "a decomposed name (not NFC)": { first_name: "Zóra" },
        "a lowercase initial": { first_name: "Anna", family_initial: "k" },
        "an initial that is not a letter": { first_name: "Anna", family_initial: "1" },
        "two letters as the initial": { first_name: "Anna", family_initial: "KO" },
        "an initial without a name": { family_initial: "K" },
        "an unknown region": { region: "polska" },
        "an unknown visibility": { visibility: "friends" },
      };

      for (const [why, values] of Object.entries(bad)) {
        await expect(insertRaw(explorerA, values), why).rejects.toThrow(
          /violates check constraint/,
        );
      }

      expect(await rowsOf(explorerA.id)).toEqual([]);
      await insertRaw(explorerA, { first_name: "Żaneta", family_initial: "Ł", region: "lodzkie" });
      expect(await rowsOf(explorerA.id)).toHaveLength(1);
      await admin$(`delete from public.profiles where user_id = $1`, [explorerA.id]);
    });
  });

  describe("the use cases", () => {
    it("gives the defaults before the first save: private, without a name (Q1, D-E9-2)", async () => {
      expect(await getMyProfile(explorerA, deps())).toEqual({
        status: "ok",
        value: DEFAULT_PROFILE,
      });
      expect(await rowsOf(explorerA.id)).toEqual([]);
    });

    it("saves, reads back, and replaces the same row on the next save", async () => {
      expect(await saveMyProfile(explorerA, input(annaK), deps())).toEqual({
        status: "ok",
        value: annaK,
      });
      expect(await getMyProfile(explorerA, deps())).toEqual({ status: "ok", value: annaK });

      const [first] = await rowsOf(explorerA.id);

      expect(
        await saveMyProfile(explorerA, { ...annaK, visibility: "private", region: "" }, deps()),
      ).toEqual({
        status: "ok",
        value: { ...annaK, visibility: "private", region: null },
      });

      const rows = await rowsOf(explorerA.id);

      expect(rows).toHaveLength(1);
      expect(rows[0]!.user_id).toBe(explorerA.id);
      expect(rows[0]!.visibility).toBe("private");
      expect((rows[0]!.updated_at as Date).getTime()).toBeGreaterThan(
        (first!.updated_at as Date).getTime(),
      );
    });

    it("answers invalid and rate_limited without writing, and a guest is refused before the database", async () => {
      expect(await saveMyProfile(explorerB, { ...annaK, region: "polska" }, deps())).toEqual({
        status: "invalid",
        fields: ["region"],
      });
      expect(await saveMyProfile(explorerB, input(annaK), deps(false))).toEqual({
        status: "rate_limited",
        retryAfterSeconds: 30,
      });
      expect(await saveMyProfile(null, input(annaK), deps())).toEqual({
        status: "unauthenticated",
      });
      expect(await getMyProfile(null, deps())).toEqual({ status: "unauthenticated" });
      expect(await rowsOf(explorerB.id)).toEqual([]);
    });

    it("never takes an owner from the body: a body with a user id is invalid and writes nothing", async () => {
      expect(await saveMyProfile(explorerB, { ...annaK, userId: explorerA.id }, deps())).toEqual({
        status: "invalid",
        fields: [],
      });
      expect(await saveMyProfile(explorerB, { ...annaK, user_id: explorerA.id }, deps())).toEqual({
        status: "invalid",
        fields: [],
      });
      expect(await rowsOf(explorerB.id)).toEqual([]);
    });
  });

  describe("explorer A against explorer B, a curator, an administrator and a guest", () => {
    const other: Profile = {
      firstName: "Bartek",
      familyInitial: null,
      region: "slaskie",
      visibility: "public",
    };

    it("keeps the profile of A from B: not read, not changed, not removed, not inserted for A, also with raw SQL", async () => {
      await saveMyProfile(explorerA, input(annaK), deps());

      expect(await getMyProfile(explorerB, deps())).toEqual({
        status: "ok",
        value: DEFAULT_PROFILE,
      });
      expect(await as(explorerB, `select * from public.profiles`)).toEqual([]);
      expect(
        await as(explorerB, `select * from public.profiles where user_id = ?`, [explorerA.id]),
      ).toEqual([]);
      // B updates and "removes" nothing of A: no row matches B, and there is no DELETE grant at all.
      expect(
        await as(
          explorerB,
          `update public.profiles set first_name = 'Zbyszek' where user_id = ? returning *`,
          [explorerA.id],
        ),
      ).toEqual([]);
      expect(
        await as(explorerB, `update public.profiles set visibility = 'public' returning *`),
      ).toEqual([]);
      await expect(
        as(explorerB, `delete from public.profiles where user_id = ?`, [explorerA.id]),
      ).rejects.toThrow(/permission denied/);
      // B cannot even name an owner: the INSERT privilege does not cover `user_id` (42501).
      await expect(
        as(
          explorerB,
          `insert into public.profiles (user_id, first_name) values (?, 'Podrobiony')`,
          [explorerA.id],
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        as(
          explorerB,
          `update public.profiles set user_id = ? where user_id = app_current_user_id()`,
          [explorerA.id],
        ),
      ).rejects.toThrow(/permission denied/);

      expect((await rowsOf(explorerA.id))[0]).toMatchObject({
        first_name: "Anna",
        family_initial: "K",
        region: "pomorskie",
        visibility: "public",
      });
    });

    it("lets B save a profile of their own over the same statement, leaving the row of A untouched", async () => {
      await saveMyProfile(explorerA, input(annaK), deps());

      expect(await saveMyProfile(explorerB, input(other), deps())).toEqual({
        status: "ok",
        value: other,
      });
      expect(
        await saveMyProfile(explorerB, input({ ...other, firstName: "Bolek" }), deps()),
      ).toMatchObject({
        status: "ok",
        value: { firstName: "Bolek" },
      });
      expect(await getMyProfile(explorerA, deps())).toEqual({ status: "ok", value: annaK });
      expect(await getMyProfile(explorerB, deps())).toMatchObject({
        value: { firstName: "Bolek" },
      });
      expect(await rowsOf(explorerB.id)).toHaveLength(1);
    });

    it("does not show profiles to a curator or an administrator (roles do not inherit)", async () => {
      await saveMyProfile(explorerA, input(annaK), deps());
      await saveMyProfile(explorerB, input(other), deps());

      for (const actor of [curator, administrator]) {
        expect(await as(actor, `select * from public.profiles`), actor.email).toEqual([]);
        expect(await getMyProfile(actor, deps())).toEqual({ status: "ok", value: DEFAULT_PROFILE });
        await expect(
          as(actor, `insert into public.profiles (user_id, first_name) values (?, 'X')`, [
            explorerA.id,
          ]),
        ).rejects.toThrow(/permission denied/);
        expect(
          await as(actor, `update public.profiles set first_name = 'Hak' returning *`),
        ).toEqual([]);
      }
    });

    it("shows a guest and a connection without a context no rows and refuses their writes", async () => {
      await saveMyProfile(explorerA, input(annaK), deps());

      expect(await asGuest(`select * from public.profiles`)).toEqual([]);
      await expect(
        asGuest(`insert into public.profiles (first_name) values ('Gość')`),
        // The guest context is a read-only transaction: the write is refused before any policy.
      ).rejects.toThrow(/read-only transaction/);
      expect(await app.em.execute(`select * from public.profiles`)).toEqual([]);
      await expect(
        app.em.execute(`insert into public.profiles (first_name) values ('Bez kontekstu')`),
      ).rejects.toThrow();
      expect(
        await admin$(`select 1 from public.profiles where first_name in ('Gość', 'Bez kontekstu')`),
      ).toEqual([]);
    });

    it("does not leak the context of one request into the next on the same connection", async () => {
      await saveMyProfile(explorerA, input(annaK), deps());
      expect(await as(explorerA, `select first_name from public.profiles`)).toEqual([
        { first_name: "Anna" },
      ]);
      expect(
        await as(explorerB, `select first_name from public.profiles where user_id = ?`, [
          explorerA.id,
        ]),
      ).toEqual([]);
      expect(await app.em.execute(`select first_name from public.profiles`)).toEqual([]);
    });
  });

  describe("the other roles of the database", () => {
    it("binds the owner of the table by FORCE ROW LEVEL SECURITY: krajozbior_owner sees no row of anybody", async () => {
      await saveMyProfile(explorerA, input(annaK), deps());
      expect(await rowsOf(explorerA.id)).toHaveLength(1);

      const seenByOwner = await withClient(
        db.urls.krajozbior_owner,
        async (client) => (await client.query(`select * from public.profiles`)).rows,
      );

      expect(seenByOwner).toEqual([]);
    });

    it("gives krajozbior_auth and krajozbior_ops no access to the table", async () => {
      for (const url of [db.urls.krajozbior_auth, db.urls.krajozbior_ops]) {
        await withClient(url, async (client) => {
          await expect(client.query(`select * from public.profiles`)).rejects.toMatchObject({
            code: "42501",
          });
          await expect(
            client.query(`insert into public.profiles (user_id) values ($1)`, [explorerA.id]),
          ).rejects.toMatchObject({ code: "42501" });
        });
      }
    });
  });
});
