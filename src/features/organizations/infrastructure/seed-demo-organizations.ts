import "server-only";

import { DEMO_EMAIL_DOMAIN } from "@/features/identity/domain/demo-account-list";

import { connectOpsCurator } from "./postgres-ops-curator";
import type { OpsCuratorResult } from "../application/ops-curator-types";
import type { OrganizationKind } from "../domain/organization";

// Two demo organizations with one curator each (E1, PR1), so two curators of
// different organizations can show that one cannot see the other's drafts.
// The accounts themselves come from demoAccounts (identity); this module only
// grants the memberships, through the same audited path as `npm run ops:curator`,
// so running the seed again changes nothing (`noop`).
export const demoOrganizations: readonly {
  slug: string;
  name: string;
  kind: OrganizationKind;
  curatorEmail: string;
}[] = [
  {
    slug: "demo-gmina-a",
    name: "Gmina A (demo)",
    kind: "municipality",
    curatorEmail: `curator-a@${DEMO_EMAIL_DOMAIN}`,
  },
  {
    slug: "demo-pttk-b",
    name: "Oddział PTTK B (demo)",
    kind: "pttk",
    curatorEmail: `curator-b@${DEMO_EMAIL_DOMAIN}`,
  },
];

const SEED_OPERATOR = "seed-demo";
const SEED_REASON = "Konto demo lokalnego środowiska";

/** Fails when any demo membership was refused, so the seed does not end with partial data. */
export function assertDemoOrganizationsSeeded(results: readonly OpsCuratorResult[]): void {
  const rejected = results.filter(({ outcome }) => outcome === "rejected");

  if (rejected.length > 0) {
    throw new Error(
      `Demo organizations were refused: ${rejected
        .map(({ organizationSlug, code }) => `${organizationSlug} (${code ?? "unknown"})`)
        .join(", ")}`,
    );
  }
}

/** Grants the demo memberships as krajozbior_ops (`connectionString`). */
export async function seedDemoOrganizations(connectionString: string): Promise<OpsCuratorResult[]> {
  const connection = await connectOpsCurator(connectionString);

  try {
    const results: OpsCuratorResult[] = [];

    for (const { slug, name, kind, curatorEmail } of demoOrganizations) {
      results.push(
        await connection.gateway.grantCurator({
          orgSlug: slug,
          email: curatorEmail,
          name,
          kind,
          operator: SEED_OPERATOR,
          reason: SEED_REASON,
        }),
      );
    }

    return results;
  } finally {
    await connection.close();
  }
}
