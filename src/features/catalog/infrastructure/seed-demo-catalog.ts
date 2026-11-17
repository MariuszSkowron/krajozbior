import "server-only";

import { randomInt } from "node:crypto";

import { MikroORM } from "@mikro-orm/postgresql";
import { Client } from "pg";

import { createOrmConfig } from "@/lib/db/config";
import { runInGuestContext, runInUserContext } from "@/lib/db/user-context";

import type { CatalogDeps } from "../application/catalog-types";
import { publishCollection } from "../application/curator-collections";
import { addPlace } from "../application/curator-places";
import { postgresCatalogRepository } from "./postgres-catalog-repository";

// One published sample collection for the demo (E1, PR2). It goes through the
// curator use cases as the demo curator: a draft first, then the ordinary
// publication (never inserted as published, so first_published_at is set by the
// trigger). Running it again changes nothing.
export const DEMO_COLLECTION_TITLE = "Mosty i zamki nad Wisłą (demo)";
export const DEMO_COLLECTION_SLUG = "demo-mosty-i-zamki-nad-wisla";

const demoPlaces = [
  { name: "Most Tczewski", latitude: 54.0928, longitude: 18.7919, address: "Tczew" },
  { name: "Zamek w Gniewie", latitude: 53.8365, longitude: 18.8246, address: "Gniew" },
  { name: "Zamek w Malborku", latitude: 54.0397, longitude: 19.0286, address: "Malbork" },
];

export type DemoCatalogResult = "created" | "noop";

/**
 * `appUrl` is the krajozbior_app connection, `ownerUrl` krajozbior_owner (only
 * to find the curator account by e-mail, which krajozbior_app cannot read).
 */
export async function seedDemoCatalog(
  appUrl: string,
  ownerUrl: string,
  curatorEmail: string,
): Promise<DemoCatalogResult> {
  const owner = new Client({ connectionString: ownerUrl });

  await owner.connect();

  let curatorId: string | undefined;

  try {
    curatorId = (
      await owner.query<{ id: string }>(`select id from auth.users where email = $1`, [
        curatorEmail,
      ])
    ).rows[0]?.id;
  } finally {
    await owner.end();
  }

  if (curatorId === undefined) {
    throw new Error("Demo curator account is missing: run the demo accounts seed first");
  }

  const actor = { id: curatorId, role: "user" as const };
  const orm = await MikroORM.init(createOrmConfig(appUrl));

  try {
    const deps: CatalogDeps = {
      withUserContext: (who, work) => runInUserContext(orm.em, who, work),
      withGuestContext: (work) => runInGuestContext(orm.em, work),
      limiter: { reserve: async () => ({ allowed: true }) },
      repository: postgresCatalogRepository,
      random: (max) => randomInt(max),
    };

    // Resumable: the collection is found by its fixed slug (not by title), and
    // each run continues from the stored state, so a run that failed halfway is
    // repaired by the next one.
    const repository = deps.repository;
    const state = await runInUserContext(orm.em, actor, async (tx) => {
      const organizationId = (await repository.permittedOrganizationIds(tx))[0];

      if (organizationId === undefined) {
        throw new Error("Demo curator has no organization");
      }

      await repository.insertCollection(tx, {
        title: DEMO_COLLECTION_TITLE,
        summary: "Kolekcja przykładowa.",
        region: "pomorskie",
        organizationId,
        slug: DEMO_COLLECTION_SLUG,
      });

      const rows = await tx.em.execute<{ id: string; status: string; version: number }[]>(
        `select id, status, version from public.collections
          where slug = ? and organization_id = ?`,
        [DEMO_COLLECTION_SLUG, organizationId],
      );

      if (rows[0] === undefined) {
        throw new Error("Demo collection address is taken by another organization");
      }

      return {
        ...rows[0],
        placeCount: (await repository.listCollectionPlaceIds(tx, rows[0].id)).length,
      };
    });

    if (state.status === "published" && state.placeCount >= demoPlaces.length) {
      return "noop";
    }

    for (const place of demoPlaces.slice(state.placeCount)) {
      const added = await addPlace(actor, state.id, place, deps);

      if (added.status !== "ok") {
        throw new Error(`Demo place was refused: ${added.status}`);
      }
    }

    if (state.status !== "published") {
      const published = await publishCollection(actor, state.id, { version: state.version }, deps);

      if (published.status !== "ok") {
        throw new Error(`Demo collection was not published: ${published.status}`);
      }
    }

    return "created";
  } finally {
    await orm.close(true);
  }
}
