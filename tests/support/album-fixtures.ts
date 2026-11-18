import { randomUUID } from "node:crypto";

import type { MikroORM } from "@mikro-orm/postgresql";

import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";
import { withClient, type ScratchDatabase } from "./database-harness";

// Shared fixtures of the album tests (album-access, visits-access): users,
// organizations and published collections on a scratch database. Rows are made
// the way the application makes them: curators write as krajozbior_app in their
// own user context, so a fixture never skips a policy. The superuser connection
// only inserts accounts and organizations and reads back.
export type TestUser = { id: string; email: string };

export const rejectedByPolicy = /row-level security/;

export const newUser = (name: string): TestUser => ({
  id: randomUUID(),
  email: `${name}@example.com`,
});

export function albumFixtures(source: { db: () => ScratchDatabase; app: () => MikroORM }) {
  let counter = 0;

  const admin$ = <T>(sql: string, params: unknown[] = []) =>
    withClient(
      source.db().adminUrl,
      async (client) => (await client.query(sql, params)).rows as T[],
    );

  const as = (actor: { id: string }, sql: string, params: unknown[] = []) =>
    runInUserContext(source.app().em, actor, ({ em }) =>
      em.execute<Record<string, unknown>[]>(sql, params),
    );

  const asGuest = (sql: string, params: unknown[] = []) =>
    runInGuestContext(source.app().em, ({ em }) =>
      em.execute<Record<string, unknown>[]>(sql, params),
    );

  const insertUsers = async (users: TestUser[]) => {
    for (const { id, email } of users) {
      await admin$(`insert into auth.users (id, name, email) values ($1, $2, $3)`, [
        id,
        email.split("@")[0],
        email,
      ]);
    }
  };

  const newOrganization = async (name: string, slug: string, members: TestUser[]) => {
    const [{ id }] = await admin$<{ id: string }>(
      `insert into public.organizations (name, slug, kind) values ($1, $2, 'municipality') returning id`,
      [name, slug],
    );

    for (const member of members) {
      await admin$(
        `insert into public.organization_members (organization_id, user_id) values ($1, $2)`,
        [id, member.id],
      );
    }

    return id;
  };

  const newCollection = async (actor: { id: string }, organizationId: string): Promise<string> =>
    (
      await as(
        actor,
        `insert into public.collections (slug, organization_id, title, region)
         values (?, ?, 'Kolekcja', 'pomorskie') returning id`,
        [`kolekcja-${(counter += 1)}`, organizationId],
      )
    )[0]!.id as string;

  // Placed 54.0, 18.0 with the default radius of 200 m, unless told otherwise.
  const newPlace = async (
    actor: { id: string },
    organizationId: string,
    radiusM = 200,
  ): Promise<string> =>
    (
      await as(
        actor,
        `insert into public.places (organization_id, name, latitude, longitude, visit_radius_m)
         values (?, 'Miejsce', 54.0, 18.0, ?) returning id`,
        [organizationId, radiusM],
      )
    )[0]!.id as string;

  const link = (
    actor: { id: string },
    collectionId: string,
    placeId: string,
    organizationId: string,
    position = 1,
  ) =>
    as(
      actor,
      `insert into public.collection_places (collection_id, place_id, organization_id, position)
       values (?, ?, ?, ?)`,
      [collectionId, placeId, organizationId, position],
    );

  const setStatus = (actor: { id: string }, collectionId: string, status: "draft" | "published") =>
    as(actor, `update public.collections set status = ? where id = ? returning id`, [
      status,
      collectionId,
    ]);

  // A draft collection with `placeCount` places of the organization.
  async function draftCollection(actor: { id: string }, organizationId: string, placeCount = 1) {
    const collectionId = await newCollection(actor, organizationId);
    const placeIds: string[] = [];

    for (let i = 1; i <= placeCount; i += 1) {
      const placeId = await newPlace(actor, organizationId);

      await link(actor, collectionId, placeId, organizationId, i);
      placeIds.push(placeId);
    }

    return { collectionId, placeIds };
  }

  async function publishedCollection(
    actor: { id: string },
    organizationId: string,
    placeCount = 1,
  ) {
    const made = await draftCollection(actor, organizationId, placeCount);

    await setStatus(actor, made.collectionId, "published");

    return made;
  }

  return {
    admin$,
    as,
    asGuest,
    insertUsers,
    newOrganization,
    newCollection,
    newPlace,
    link,
    setStatus,
    draftCollection,
    publishedCollection,
    suspendOrganization: (id: string) =>
      admin$(`update public.organizations set status = 'suspended' where id = $1`, [id]),
    approveOrganization: (id: string) =>
      admin$(`update public.organizations set status = 'approved' where id = $1`, [id]),
  };
}
