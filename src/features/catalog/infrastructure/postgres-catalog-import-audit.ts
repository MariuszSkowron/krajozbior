import "server-only";

import { Client } from "pg";

import { writeAuditEntry } from "@/lib/db/operations-audit";

import type { ImportAuditGateway } from "../application/catalog-import-command";
import { startDetails } from "../application/catalog-import-audit";

// The audit of the server loader as krajozbior_ops (DATABASE_OPS_URL): every
// entry is its own committed statement on a short connection, so the entry
// "start" exists before the first write of the load and survives its failure.
// The role may insert the audit but owns no table and may not update or delete
// (Migration20261118120000, Migration20261121140000).

async function withOps<T>(opsUrl: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: opsUrl });

  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export function createPostgresImportAudit(opsUrl: string): ImportAuditGateway {
  return {
    start: ({ batch, orgSlug, curatorEmail, operator, reason }) =>
      withOps(opsUrl, async (client) => {
        const subject = (
          await client.query<{ user_id: string }>(`select user_id from public.ops_find_user($1)`, [
            curatorEmail,
          ])
        ).rows[0]?.user_id;
        const organization = (
          await client.query<{ id: string }>(
            `select id from public.organizations where slug = $1`,
            [orgSlug],
          )
        ).rows[0]?.id;
        const subjectUserId = subject ?? null;
        const organizationId = organization ?? null;
        const entryId = await writeAuditEntry(client, {
          operation: batch.operation,
          operator,
          reason,
          subjectUserId,
          organizationId,
          before: null,
          after: null,
          outcome: "applied",
          code: null,
          details: startDetails(batch),
        });

        return { entryId, organizationId, subjectUserId };
      }),
    finish: (handle, { batch, operator, reason, result }) =>
      withOps(opsUrl, async (client) => {
        await writeAuditEntry(client, {
          operation: batch.operation,
          operator,
          reason,
          subjectUserId: handle.subjectUserId,
          organizationId: handle.organizationId,
          before: null,
          after: null,
          outcome: result.outcome,
          code: result.code,
          details: result.details,
        });
      }),
  };
}
