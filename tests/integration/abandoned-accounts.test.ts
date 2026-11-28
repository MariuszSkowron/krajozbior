import { MikroORM } from "@mikro-orm/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteAccountRows } from "@/features/identity/infrastructure/delete-account-rows";
import { deleteAbandonedAccounts } from "@/features/identity/infrastructure/postgres-abandoned-accounts-cleanup";
import { createOrmConfig } from "@/lib/db/config";
import { albumFixtures, newUser } from "../support/album-fixtures";
import {
  closePool,
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// Polityka prywatności 1.1 §3 i §9, regulamin rozdz. 4 ust. 2 (C1a): odmowa akceptacji usuwa konto
// od razu, a konto bez żadnej akceptacji znika po 7 dniach. Prawdziwa baza, prawdziwe role
// logowania: krajozbior_auth kasuje istniejącą ścieżką (deleteAccountRows) i pyta bazę, czy konto
// jest porzucone (auth_account_is_abandoned). Superużytkownik tylko przygotowuje dane.
const denied = { code: "42501" };

let db: ScratchDatabase;
let app: MikroORM;
let authPool: Pool;

const f = albumFixtures({ db: () => db, app: () => app });
const { admin$, as } = f;

const exists = async (id: string) =>
  (await admin$(`select 1 from auth.users where id = $1`, [id])).length === 1;

const auditEntries = async (id: string) =>
  admin$<{ operator_label: string }>(
    `select operator_label from public.operations_audit
      where operation = 'delete_account' and subject_user_id = $1`,
    [id],
  );

// A new account that is `days` days old; optionally with an acceptance, an organization or the
// administrator role (set by the superuser with the audit trigger of the role switched off).
async function account(
  name: string,
  options: { days?: number; accepted?: boolean; organization?: boolean; admin?: boolean } = {},
) {
  const user = newUser(`${name}-${Math.random().toString(36).slice(2, 8)}`);

  await f.insertUsers([user]);
  await admin$(
    `update auth.users set created_at = now() - make_interval(days => $2) where id = $1`,
    [user.id, options.days ?? 0],
  );
  await admin$(
    `insert into auth.sessions (expires_at, token, user_id)
                values (now() + interval '1 day', $2, $1)`,
    [user.id, `token-${user.id}`],
  );

  if (options.accepted === true) {
    await as(user, `insert into public.terms_acceptance (terms_version) values ('0.2')`);
  }

  if (options.organization === true) {
    await f.newOrganization(`Gmina ${user.id}`, `gmina-${user.id}`, [user]);
  }

  if (options.admin === true) {
    await admin$(`alter table auth.users disable trigger auth_users_role_audited_update`);
    await admin$(`update auth.users set role = 'admin' where id = $1`, [user.id]);
    await admin$(`alter table auth.users enable trigger auth_users_role_audited_update`);
  }

  return user;
}

describe("accounts without an accepted version of the terms", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_abandoned_accounts");
    await db.migrate();
    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });
    authPool = new Pool({ connectionString: db.urls.krajozbior_auth, max: 3 });
  }, 60_000);

  afterAll(async () => {
    await closePool(authPool);
    await app?.close(true);
    await db?.drop();
  });

  describe("a declined acceptance (age 0)", () => {
    it("deletes the account, its sessions and leaves an audit entry written by the database", async () => {
      const user = await account("declined");

      expect(await deleteAccountRows(authPool, user.id, { onlyAbandonedOlderThanDays: 0 })).toBe(
        true,
      );
      expect(await exists(user.id)).toBe(false);
      expect(await admin$(`select 1 from auth.sessions where user_id = $1`, [user.id])).toEqual([]);
      expect((await auditEntries(user.id)).map((row) => row.operator_label)).toEqual([
        "self-service",
      ]);
    });

    it("deletes only that account, never another one", async () => {
      const mine = await account("mine");
      const other = await account("other");

      expect(await deleteAccountRows(authPool, mine.id, { onlyAbandonedOlderThanDays: 0 })).toBe(
        true,
      );
      expect(await exists(other.id)).toBe(true);
    });

    it("refuses an account that accepted any version of the terms (it stays, with its rows)", async () => {
      const user = await account("accepted", { accepted: true });

      expect(await deleteAccountRows(authPool, user.id, { onlyAbandonedOlderThanDays: 0 })).toBe(
        false,
      );
      expect(await exists(user.id)).toBe(true);
      expect(
        await admin$(`select 1 from public.terms_acceptance where user_id = $1`, [user.id]),
      ).toHaveLength(1);
      expect(await auditEntries(user.id)).toEqual([]);
    });

    it("refuses an administrator and a curator (a member of an organization)", async () => {
      const administrator = await account("admin", { admin: true });
      const curator = await account("curator", { organization: true });

      for (const user of [administrator, curator]) {
        expect(await deleteAccountRows(authPool, user.id, { onlyAbandonedOlderThanDays: 0 })).toBe(
          false,
        );
        expect(await exists(user.id)).toBe(true);
      }
    });

    it("answers false for an account that is already gone", async () => {
      expect(
        await deleteAccountRows(authPool, "00000000-0000-4000-8000-000000000000", {
          onlyAbandonedOlderThanDays: 0,
        }),
      ).toBe(false);
    });
  });

  describe("the 7-day cleanup", () => {
    it("removes only accounts without an acceptance that are older than 7 days", async () => {
      await admin$(`truncate auth.users cascade`);
      const old = await account("old", { days: 8 });
      const exactlyOld = await account("old2", { days: 30 });
      const young = await account("young", { days: 6 });
      const fresh = await account("fresh", { days: 0 });
      const acceptedOld = await account("accepted-old", { days: 40, accepted: true });
      const curatorOld = await account("curator-old", { days: 40, organization: true });
      const adminOld = await account("admin-old", { days: 40, admin: true });

      expect(await deleteAbandonedAccounts(authPool)).toBe(2);

      expect(await exists(old.id)).toBe(false);
      expect(await exists(exactlyOld.id)).toBe(false);

      for (const kept of [young, fresh, acceptedOld, curatorOld, adminOld]) {
        expect(await exists(kept.id), kept.email).toBe(true);
      }

      expect(await deleteAbandonedAccounts(authPool)).toBe(0);
    });

    it("removes at most one batch per pass and continues on the next", async () => {
      await admin$(`truncate auth.users cascade`);

      for (let i = 0; i < 3; i += 1) {
        await account(`batch-${i}`, { days: 10 });
      }

      expect(await deleteAbandonedAccounts(authPool, 7, 2)).toBe(2);
      expect(await deleteAbandonedAccounts(authPool, 7, 2)).toBe(1);
    });
  });

  describe("access to the guard function", () => {
    it("is executable by krajozbior_auth only", async () => {
      const user = await account("probe");

      for (const role of ["krajozbior_app", "krajozbior_ops"] as const) {
        await withClient(db.urls[role], async (client) => {
          await expect(
            client.query(`select public.auth_account_is_abandoned($1, interval '0')`, [user.id]),
          ).rejects.toMatchObject(denied);
        });
      }

      await withClient(db.urls.krajozbior_auth, async (client) => {
        expect(
          (
            await client.query(`select public.auth_account_is_abandoned($1, interval '0') as a`, [
              user.id,
            ])
          ).rows[0].a,
        ).toBe(true);
      });
    });

    it("keeps krajozbior_owner blind to the acceptances outside the function", async () => {
      const user = await account("blind", { accepted: true });

      await withClient(db.urls.krajozbior_owner, async (client) => {
        expect(
          (
            await client.query(`select * from public.terms_acceptance where user_id = $1`, [
              user.id,
            ])
          ).rows,
        ).toEqual([]);
      });
    });

    it("lets neither krajozbior_app nor krajozbior_auth read or delete acceptances to dodge the guard", async () => {
      const user = await account("dodge", { accepted: true });

      await withClient(db.urls.krajozbior_auth, async (client) => {
        await expect(client.query(`select * from public.terms_acceptance`)).rejects.toMatchObject(
          denied,
        );
        await expect(
          client.query(`delete from public.terms_acceptance where user_id = $1`, [user.id]),
        ).rejects.toMatchObject(denied);
      });
      await expect(
        as(user, `delete from public.terms_acceptance where user_id = app_current_user_id()`),
      ).rejects.toThrow();
      expect(await deleteAccountRows(authPool, user.id, { onlyAbandonedOlderThanDays: 0 })).toBe(
        false,
      );
    });
  });

  describe("the migration", () => {
    it("is neutral for the own deletion of an account that accepted the terms (E9-5)", async () => {
      const user = await account("own", { accepted: true });

      expect(await deleteAccountRows(authPool, user.id)).toBe(true);
      expect(await exists(user.id)).toBe(false);
    });
  });
});
