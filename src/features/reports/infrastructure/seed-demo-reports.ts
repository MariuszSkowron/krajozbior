import "server-only";

import { MikroORM } from "@mikro-orm/postgresql";
import { Client } from "pg";

import { isDemoSignInAllowed } from "@/lib/config/env";
import { createOrmConfig } from "@/lib/db/config";
import { runInUserContext } from "@/lib/db/user-context";

// Three sample reports for the demo (P4b): two waiting, one rejected, all from the demo explorer
// about places of the first demo organization, so a demo curator has a queue to work on. They are
// written as the explorer (krajozbior_app, the INSERT policy needs the author) and decided as the
// curator through the same functions the panel uses. Running it again changes nothing.
export const demoReports = [
  {
    placeName: "Most Tczewski",
    category: "closed",
    message: "Brama przy wejściu była zamknięta, na tablicy wiszą inne godziny niż w opisie.",
    decision: null,
  },
  {
    placeName: "Zamek w Gniewie",
    category: "wrong_info",
    message: "Adres w opisie prowadzi pod stary numer. Wejście jest od strony rynku.",
    decision: null,
  },
  {
    placeName: "Zamek w Malborku",
    category: "private_or_unsafe",
    message: "Ścieżka za zamkiem jest ogrodzona, wygląda na teren prywatny.",
    decision: {
      reason: "not_accurate",
      note: "Sprawdziliśmy na miejscu: ścieżka jest ogólnodostępna.",
    },
  },
] as const;

export type DemoReportsResult = "created" | "noop";

/**
 * The demo reports must never reach a shared server: the same condition that keeps the demo
 * accounts from signing in on one (production only with DEMO_ACCOUNTS_TEST_ONLY=1 and a loopback
 * address). Throws, so the seed ends with a non-zero code.
 */
export function assertDemoReportsAllowed(source: Record<string, string | undefined>): void {
  if (!isDemoSignInAllowed(source)) {
    throw new Error("Demo reports are seeded only where the demo accounts may sign in");
  }
}

async function findUserId(opsUrl: string, email: string): Promise<string> {
  const ops = new Client({ connectionString: opsUrl });

  await ops.connect();

  try {
    const id = (
      await ops.query<{ user_id: string }>(`select user_id from public.ops_find_user($1)`, [email])
    ).rows[0]?.user_id;

    if (id === undefined) {
      throw new Error(`Demo account is missing: ${email}. Run the demo accounts seed first`);
    }

    return id;
  } finally {
    await ops.end();
  }
}

/**
 * `appUrl` is the krajozbior_app connection, `opsUrl` krajozbior_ops (only to find the two
 * accounts by e-mail through `ops_find_user`). Needs the demo catalog (the places of the sample
 * collection) to exist.
 */
export async function seedDemoReports(
  appUrl: string,
  opsUrl: string,
  explorerEmail: string,
  curatorEmail: string,
  source: Record<string, string | undefined> = process.env,
): Promise<DemoReportsResult> {
  assertDemoReportsAllowed(source);

  const explorer = { id: await findUserId(opsUrl, explorerEmail), role: "user" as const };
  const curator = { id: await findUserId(opsUrl, curatorEmail), role: "user" as const };
  const orm = await MikroORM.init(createOrmConfig(appUrl));

  try {
    const names = demoReports.map((report) => report.placeName);
    const placed = await runInUserContext(orm.em, explorer, async (tx) => {
      const places = await tx.em.execute<{ id: string; name: string }[]>(
        `select p.id, p.name from public.places p where p.name::text = any (string_to_array(?, '|'))`,
        [names.join("|")],
      );
      const existing = await tx.em.execute<{ placeId: string }[]>(
        `select place_id as "placeId" from public.place_reports where place_id is not null`,
      );

      return { places, existing: new Set(existing.map((row) => row.placeId)) };
    });

    const idOf = new Map(placed.places.map((place) => [place.name, place.id]));

    for (const report of demoReports) {
      if (!idOf.has(report.placeName)) {
        throw new Error(`Demo place is missing: ${report.placeName}. Run the demo catalog seed`);
      }
    }

    const pending = demoReports.filter(
      (report) => !placed.existing.has(idOf.get(report.placeName)!),
    );

    if (pending.length === 0) {
      return "noop";
    }

    for (const report of pending) {
      const reportId = await runInUserContext(orm.em, explorer, async (tx) => {
        const rows = await tx.em.execute<{ id: string }[]>(
          `insert into public.place_reports (place_id, category, message)
           values (?, ?, ?) returning id`,
          [idOf.get(report.placeName), report.category, report.message],
        );

        return rows[0]!.id;
      });

      if (report.decision !== null) {
        const { reason, note } = report.decision;

        await runInUserContext(orm.em, curator, (tx) =>
          tx.em.execute(`select public.app_decide_report(?::uuid, 'reject', ?, ?, 1)`, [
            reportId,
            reason,
            note,
          ]),
        );
      }
    }

    return "created";
  } finally {
    await orm.close(true);
  }
}
