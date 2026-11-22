import "server-only";

import { Client } from "pg";

import { NEWS_EDITORIAL_ORG_SLUGS } from "../application/news-import-command";
import { parseNewsImportFile } from "../application/news-import-file";
import { connectNewsImport } from "./postgres-news-import-runner";

// Demo news of the editorial organization for the local environment and the showcase
// (E7-R2a): the organization of the team and three items written through the same writer
// as `news:import` (`ops_put_news` with an entry `news_import`), so running the seed again
// changes nothing (all `unchanged`). Local use only: the seed script refuses production and
// a database outside localhost before it calls this module.
export const DEMO_NEWS_ORG_SLUG = NEWS_EDITORIAL_ORG_SLUGS[0]!;
export const DEMO_NEWS_ORG_NAME = "Krajozbiór — redakcja";

const SEED_OPERATOR = "seed-demo";
const SEED_REASON = "Aktualności demo lokalnego środowiska";

const demoItems = [
  {
    id: "5e0a1b00-0000-4000-8000-000000000001",
    kind: "guide",
    title: "Jak zbierać miejsca w kolekcjach",
    lead: "Krótko o tym, jak odhaczać odwiedzone miejsca i czym różni się kolekcja od listy.",
    body: "Wybierz kolekcję, a potem odhaczaj miejsca, które odwiedzasz.\n\nWięcej o zasadach: https://krajozbior.example/zasady",
    status: "published",
  },
  {
    id: "5e0a1b00-0000-4000-8000-000000000002",
    kind: "event",
    title: "Wiosenne spotkanie miłośników latarni",
    lead: "Wydarzenie testowe z datami, widoczne tylko w środowisku demo.",
    body: "",
    event_starts_on: "2027-04-17",
    event_ends_on: "2027-04-18",
    status: "published",
  },
  {
    id: "5e0a1b00-0000-4000-8000-000000000003",
    kind: "community",
    title: "Szkic aktualności demo",
    lead: "Szkic, którego goście nie widzą.",
    body: "",
    status: "draft",
  },
] as const;

/** Creates the editorial organization when missing, as krajozbior_ops (insert is its grant). */
async function ensureEditorialOrganization(opsUrl: string): Promise<void> {
  const client = new Client({ connectionString: opsUrl });

  await client.connect();

  try {
    await client.query(
      `insert into public.organizations (name, slug, kind, status)
       values ($1, $2, 'other', 'approved') on conflict (slug) do nothing`,
      [DEMO_NEWS_ORG_NAME, DEMO_NEWS_ORG_SLUG],
    );
  } finally {
    await client.end();
  }
}

/** Seeds the demo news; returns the counts of the states of the write. */
export async function seedDemoNews(opsUrl: string): Promise<Record<string, number>> {
  const parsed = parseNewsImportFile(demoItems.map((entry) => JSON.stringify(entry)).join("\n"));

  if (!parsed.ok) {
    throw new Error("The demo news do not pass the validation of the news file");
  }

  await ensureEditorialOrganization(opsUrl);

  const runner = await connectNewsImport(opsUrl);

  try {
    const outcome = await runner.run({
      entries: parsed.entries,
      orgSlug: DEMO_NEWS_ORG_SLUG,
      preview: false,
      operator: SEED_OPERATOR,
      reason: SEED_REASON,
    });

    if (outcome.kind !== "done") {
      throw new Error(`The demo news were refused (${outcome.code})`);
    }

    const counts: Record<string, number> = {};

    for (const state of outcome.states) {
      counts[state] = (counts[state] ?? 0) + 1;
    }

    return counts;
  } finally {
    await runner.close();
  }
}
