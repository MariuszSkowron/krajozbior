import "server-only";

import { Client } from "pg";

import { writeAuditEntry } from "@/lib/db/operations-audit";

import type {
  NewsImportRejectCode,
  NewsImportRunner,
  NewsImportRunOutcome,
  NewsImportRunRequest,
  NewsImportState,
} from "../application/news-import-command";
import { chooseNewsSlug } from "../application/news-slug";

// The writer of `news:import` (E7-R2a, spec E7 section 14.3/14.4). It connects as
// krajozbior_ops (DATABASE_OPS_URL), the role that may call `ops_put_news` and append
// to the operations audit, and nothing else. One transaction carries the whole file:
// every line calls `ops_put_news` and, for `created` and `updated`, appends an
// `applied` entry of `news_import` in the same transaction (B7). A refusal rolls the
// transaction back together with those entries; a short transaction of its own then
// appends one `rejected` entry. A preview runs the same calls and rolls back, so the
// refusals it reports are exactly those of a real write, and it writes nothing.

// The statements of one command wait at most this long for a lock and run at most this long.
export const NEWS_IMPORT_LOCK_TIMEOUT_MS = 5_000;
export const NEWS_IMPORT_STATEMENT_TIMEOUT_MS = 30_000;

const REFUSALS: readonly string[] = ["invalid_transition", "stale_link", "too_many_news"];

export type NewsImportRunnerOptions = Readonly<{
  /** Test hook: runs after the taken addresses are read and before the first write. */
  beforeWrite?: () => Promise<void>;
}>;

type ExistingRow = { id: string; slug: string; first_published_at: Date | null };
type PutRow = {
  put_result: "created" | "updated" | "unchanged";
  put_before: unknown;
  put_after: unknown;
};

const putSql = `select put_result, put_before, put_after
  from public.ops_put_news($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

function refusalCode(error: unknown): NewsImportRejectCode | null {
  const { code, message, constraint } = (error ?? {}) as {
    code?: unknown;
    message?: unknown;
    constraint?: unknown;
  };

  if (code === "P0001" && typeof message === "string" && REFUSALS.includes(message)) {
    return message as NewsImportRejectCode;
  }

  // S6: a taken address is a unique violation, not a refusal of the function.
  if (code === "23505" && typeof constraint === "string" && constraint.includes("slug")) {
    return "slug_taken";
  }

  return null;
}

export async function connectNewsImport(
  connectionString: string,
  options: NewsImportRunnerOptions = {},
): Promise<NewsImportRunner> {
  const client = new Client({
    connectionString,
    lock_timeout: NEWS_IMPORT_LOCK_TIMEOUT_MS,
    statement_timeout: NEWS_IMPORT_STATEMENT_TIMEOUT_MS,
  });

  await client.connect();

  const rollback = () => client.query("rollback").catch(() => undefined);

  // The audit has no code for a taken address; `import_refused` is the closest of the
  // existing ones. The JSON line of the command keeps the real code.
  async function recordRejection(
    request: NewsImportRunRequest,
    organizationId: string,
    code: NewsImportRejectCode,
    entry: { id: string; line: number },
  ): Promise<void> {
    try {
      await client.query("begin");
      await writeAuditEntry(client, {
        operation: "news_import",
        operator: request.operator,
        reason: request.reason,
        subjectUserId: null,
        organizationId,
        before: null,
        after: { id: entry.id, line: entry.line },
        outcome: "rejected",
        code: code === "slug_taken" ? "import_refused" : code,
      });
      await client.query("commit");
    } catch {
      await rollback();
    }
  }

  return {
    async run(request): Promise<NewsImportRunOutcome> {
      try {
        await client.query("begin");

        const org = await client.query<{ id: string }>(
          `select id from public.organizations where slug = $1`,
          [request.orgSlug],
        );
        const organizationId = org.rows[0]?.id;

        if (organizationId === undefined) {
          await rollback();

          return { kind: "refused", code: "organization_not_found" };
        }

        const existing = new Map<string, ExistingRow>();
        const taken = new Set<string>();

        for (const row of (
          await client.query<ExistingRow>(
            `select id, slug, first_published_at from public.news_posts`,
          )
        ).rows) {
          existing.set(row.id, row);
          taken.add(row.slug);
        }

        await options.beforeWrite?.();

        const states: NewsImportState[] = [];

        for (const entry of request.entries) {
          const { input } = entry;
          const current = existing.get(entry.id);
          // D-27: the address is made of the title at the first publication; before it, a
          // new item gets one too (the column is not empty), and later it stays as it is.
          const needsSlug =
            current === undefined ||
            (current.first_published_at === null && entry.status === "published");
          const slug = needsSlug
            ? chooseNewsSlug(
                input.title,
                current === undefined
                  ? taken
                  : new Set([...taken].filter((value) => value !== current.slug)),
              )
            : null;
          let put: PutRow;

          try {
            put = (
              await client.query<PutRow>(putSql, [
                entry.id,
                organizationId,
                slug,
                input.kind,
                input.title,
                input.lead,
                input.body,
                input.collectionId,
                input.placeId,
                input.eventStartsOn,
                input.eventEndsOn,
                entry.status,
              ])
            ).rows[0]!;
          } catch (error) {
            const code = refusalCode(error);

            await rollback();

            if (code === null) {
              throw error;
            }

            if (!request.preview) {
              await recordRejection(request, organizationId, code, {
                id: entry.id,
                line: entry.line,
              });
            }

            return { kind: "rejected", code, line: entry.line };
          }

          if (put.put_result === "unchanged") {
            states.push("unchanged");
            continue;
          }

          const after = put.put_after as { slug: string };

          taken.add(after.slug);
          states.push(
            put.put_result === "updated" && entry.status === "withdrawn"
              ? "withdrawn"
              : put.put_result,
          );

          if (!request.preview) {
            await writeAuditEntry(client, {
              operation: "news_import",
              operator: request.operator,
              reason: request.reason,
              subjectUserId: null,
              organizationId,
              before: put.put_before as Record<string, unknown> | null,
              after: put.put_after as Record<string, unknown>,
              outcome: "applied",
              code: null,
            });
          }
        }

        await client.query(request.preview ? "rollback" : "commit");

        return { kind: "done", states };
      } catch (error) {
        await rollback();
        throw error;
      }
    },
    close: () => client.end(),
  };
}
