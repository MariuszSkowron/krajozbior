import { randomInt, randomUUID } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { CatalogDeps } from "@/features/catalog/application/catalog-types";
import { listCuratorCollections } from "@/features/catalog/application/curator-queries";
import { postgresCatalogRepository } from "@/features/catalog/infrastructure/postgres-catalog-repository";
import type { CuratorApplicationsDeps } from "@/features/curator-applications/application/curator-application-types";
import {
  decideCuratorApplication,
  revokeCuratorRole,
} from "@/features/curator-applications/application/curator-applications";
import { postgresCuratorApplicationsRepository } from "@/features/curator-applications/infrastructure/postgres-curator-applications";
import { listMemberOrganizations } from "@/features/organizations/infrastructure/postgres-organization-reader";
import { createOrmConfig } from "@/lib/db/config";
import { runInAdminContext, runInGuestContext, runInUserContext } from "@/lib/db/user-context";

import { albumFixtures, newUser, rejectedByPolicy } from "../support/album-fixtures";
import {
  createScratchDatabase,
  withClient,
  type ScratchDatabase,
} from "../support/database-harness";

// P8 (spec "Rola kuratora", section 6): a person whose curator role was taken keeps the account
// of an explorer, and loses the panel only. The curator is made the way the product makes one:
// an application, approved by an administrator with a live session; the role is taken by the
// same functions. Everything runs as krajozbior_app (one pooled connection) on the real database.
let db: ScratchDatabase;
let app: MikroORM;

const fixtures = albumFixtures({ db: () => db, app: () => app });
const { admin$, as, asGuest } = fixtures;

const curator = newUser("byly-kurator");
const admin = newUser("administrator");
const asUser = (account: { id: string }) => ({ id: account.id, role: "user" as const });

const deps: CuratorApplicationsDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withAdminContext: (actor, token, work) => runInAdminContext(app.em, actor, token, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCuratorApplicationsRepository,
  panelEnabled: () => true,
};
const catalogDeps: CatalogDeps = {
  withUserContext: (actor, work) => runInUserContext(app.em, actor, work),
  withGuestContext: (work) => runInGuestContext(app.em, work),
  limiter: { reserve: async () => ({ allowed: true }) },
  repository: postgresCatalogRepository,
  random: (max) => randomInt(max),
};

let session: { actor: { id: string; role: "admin" }; sessionToken: string };
let applicationId = "";
let organizationId = "";
let publishedCollectionId = "";
let draftCollectionId = "";
let placeIds: string[] = [];

const counts = async () =>
  (
    await as(
      curator,
      `select (select count(*)::int from public.visits) as visits,
              (select count(*)::int from public.saved_collections) as saved,
              (select count(*)::int from public.want_to_see_places) as want,
              (select count(*)::int from public.user_collections) as own`,
    )
  )[0];

describe("a curator whose role was taken", () => {
  beforeAll(async () => {
    db = await createScratchDatabase("krajozbior_integration_former_curator");
    await db.migrate();

    await fixtures.insertUsers([curator, admin]);
    await withClient(db.adminUrl, async (client) => {
      await client.query(`alter table auth.users disable trigger auth_users_role_audited_update`);
      await client.query(`update auth.users set role = 'admin' where id = $1`, [admin.id]);
      await client.query(`alter table auth.users enable trigger auth_users_role_audited_update`);
    });

    const token = `token-${randomUUID()}`;

    await withClient(db.urls.krajozbior_auth, (client) =>
      client.query(
        `insert into auth.sessions (user_id, token, expires_at) values ($1, $2, now() + interval '1 hour')`,
        [admin.id, token],
      ),
    );
    session = { actor: { id: admin.id, role: "admin" }, sessionToken: token };

    app = await MikroORM.init({
      ...createOrmConfig(db.urls.krajozbior_app),
      pool: { min: 1, max: 1 },
    });

    // The application, as the curator sends it, and its approval by the administrator.
    applicationId = (
      await as(
        curator,
        `insert into public.curator_applications
           (organization_name, organization_kind, applicant_role, contact)
         values ('Gmina Była', 'municipality', 'promocja', 'kontakt@example.com') returning id`,
      )
    )[0]!.id as string;

    const approved = await decideCuratorApplication(
      session,
      applicationId,
      { decision: "approve", organizationName: "Gmina Była", organizationSlug: "gmina-byla" },
      deps,
    );

    organizationId = (approved.status === "ok" ? approved.value.organizationId : "") as string;

    const published = await fixtures.publishedCollection(curator, organizationId, 2);
    const draft = await fixtures.draftCollection(curator, organizationId, 1);

    publishedCollectionId = published.collectionId;
    draftCollectionId = draft.collectionId;
    placeIds = published.placeIds;

    // The private data of the explorer in the colleciton of his own organization.
    await as(
      curator,
      `insert into public.visits (user_id, place_id, kind, date_precision)
       values (?, ?, 'past', 'unknown')`,
      [curator.id, placeIds[0]],
    );
    await as(
      curator,
      `insert into public.saved_collections (user_id, collection_id) values (?, ?)`,
      [curator.id, publishedCollectionId],
    );
    await as(curator, `insert into public.want_to_see_places (user_id, place_id) values (?, ?)`, [
      curator.id,
      placeIds[1],
    ]);
    await as(
      curator,
      `insert into public.user_collections (title, summary, region) values ('Moja kolekcja', '', 'pomorskie')`,
    );
  }, 90_000);

  afterAll(async () => {
    await app?.close(true);
    await db?.drop();
  });

  it("is a curator before the role is taken, and the only member of the organization", async () => {
    const organizations = await runInUserContext(app.em, curator, (tx) =>
      listMemberOrganizations(tx),
    );
    const [sole] = await as(curator, `select public.app_is_sole_organization_member() as sole`);

    expect(organizations.map((organization) => organization.id)).toEqual([organizationId]);
    expect(sole).toEqual({ sole: true });
    expect(
      await listCuratorCollections(asUser(curator), organizationId, catalogDeps),
    ).toMatchObject({
      status: "ok",
    });
  });

  it("loses only the panel when the administrator takes the role", async () => {
    const before = await counts();

    expect(before).toEqual({ visits: 1, saved: 1, want: 1, own: 1 });

    expect(
      await revokeCuratorRole(session, applicationId, { reason: "Koniec współpracy" }, deps),
    ).toMatchObject({
      status: "ok",
    });

    // No panel: no organization, no read of the organization's collections.
    expect(await runInUserContext(app.em, curator, (tx) => listMemberOrganizations(tx))).toEqual(
      [],
    );
    expect(await listCuratorCollections(asUser(curator), organizationId, catalogDeps)).toEqual({
      status: "forbidden",
    });

    // No write to the organization's content, whether by the collection or by a new place.
    expect(
      await as(
        curator,
        `update public.collections set title = 'Zmieniona' where id = ? returning id`,
        [publishedCollectionId],
      ),
    ).toEqual([]);
    expect(
      await as(
        curator,
        `update public.collections set title = 'Zmieniona' where id = ? returning id`,
        [draftCollectionId],
      ),
    ).toEqual([]);
    await expect(
      as(
        curator,
        `insert into public.places (organization_id, name, latitude, longitude, visit_radius_m)
         values (?, 'Nowe miejsce', 54.0, 18.0, 200)`,
        [organizationId],
      ),
    ).rejects.toThrow(rejectedByPolicy);

    // The draft of the organization is no longer visible to him; the published collection is.
    expect(
      await as(curator, `select id from public.collections where id = ?`, [draftCollectionId]),
    ).toEqual([]);
    expect(
      await as(curator, `select id from public.collections where id = ?`, [publishedCollectionId]),
    ).toHaveLength(1);

    // His own data as an explorer is untouched, also in the collection of the former organization.
    expect(await counts()).toEqual(before);
  });

  it("leaves the collections of the organization published, also for a guest", async () => {
    expect(
      await asGuest(`select id, status from public.collections where id = ?`, [
        publishedCollectionId,
      ]),
    ).toEqual([{ id: publishedCollectionId, status: "published" }]);
    expect(await asGuest(`select id from public.places where id = ?`, [placeIds[0]])).toHaveLength(
      1,
    );
  });

  it("writes the revocation to the audit and no longer counts him as the sole member", async () => {
    const entries = await admin$<Record<string, unknown>>(
      `select * from public.operations_audit where operation = 'revoke_curator' and subject_user_id = $1`,
      [curator.id],
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      outcome: "applied",
      organization_id: organizationId,
      recorded_by: "krajozbior_app",
      before_state: { member: true, organizationSlug: "gmina-byla", applicationId },
      after_state: { member: false, adminUserId: admin.id },
    });

    // The guard of the deletion of the account looks at members: there is none left to protect.
    expect(await as(curator, `select public.app_is_sole_organization_member() as sole`)).toEqual([
      { sole: false },
    ]);
    expect(
      await admin$(`select 1 from public.organization_members where user_id = $1`, [curator.id]),
    ).toHaveLength(0);
  });
});
