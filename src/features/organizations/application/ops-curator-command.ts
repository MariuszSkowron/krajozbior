import { parseArgs } from "node:util";

import { z } from "zod";

import { auditOperatorSchema, auditReasonSchema } from "@/lib/db/operations-audit";

import {
  ORGANIZATION_KINDS,
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_SLUG_MAX_LENGTH,
  ORGANIZATION_SLUG_PATTERN,
  type OrganizationStatus,
} from "../domain/organization";
import type { OpsCuratorGateway, OpsCuratorResult } from "./ops-curator-types";

// Pure part of the ops:curator command (D-T7): argument parsing and the mapping
// of results and errors to exit codes. No I/O of its own, so it runs without a
// database. Exit codes: 0 applied/noop, 2 input error, 3 domain refusal,
// 1 infrastructure failure.

export type OpsCuratorCommand =
  | Readonly<{
      kind: "grant";
      orgSlug: string;
      email: string;
      name?: string;
      organizationKind?: (typeof ORGANIZATION_KINDS)[number];
      operator: string;
      reason: string;
    }>
  | Readonly<{ kind: "revoke"; orgSlug: string; email: string; operator: string; reason: string }>
  | Readonly<{
      kind: "set-status";
      orgSlug: string;
      status: OrganizationStatus;
      operator: string;
      reason: string;
    }>;

export type ParseResult =
  Readonly<{ ok: true; command: OpsCuratorCommand }> | Readonly<{ ok: false; hint: string }>;

export type CliOutput = Readonly<{
  exitCode: 0 | 1 | 2 | 3;
  stdout: readonly string[];
  stderr: readonly string[];
}>;

const USAGE = [
  "Użycie:",
  '  ops:curator grant --org-slug <slug> --email <e-mail> --reason "<powód>" [--name "<nazwa>" --kind <rodzaj>] [--operator <etykieta>]',
  '  ops:curator revoke --org-slug <slug> --email <e-mail> --reason "<powód>" [--operator <etykieta>]',
  '  ops:curator suspend --org-slug <slug> --reason "<powód>" [--operator <etykieta>]',
  '  ops:curator approve --org-slug <slug> --reason "<powód>" [--operator <etykieta>]',
  `Rodzaje organizacji: ${ORGANIZATION_KINDS.join(", ")}.`,
  "Powód trafia do dziennika na stałe: bez adresów e-mail (znak @).",
].join("\n");

const FLAGS = ["org-slug", "email", "name", "kind", "reason", "operator"] as const;

// Control characters (Unicode Cc) are refused before trimming, like in the
// audit CHECKs: no line breaks or terminal escapes in the audit.
const text = (max: number) =>
  z
    .string()
    .regex(/^\P{Cc}*$/u)
    .trim()
    .min(1)
    .max(max);

const slug = z.string().max(ORGANIZATION_SLUG_MAX_LENGTH).regex(ORGANIZATION_SLUG_PATTERN);
const email = z.email().max(254);
const common = { reason: auditReasonSchema, operator: auditOperatorSchema };

const grantSchema = z.strictObject({
  "org-slug": slug,
  email,
  name: text(ORGANIZATION_NAME_MAX_LENGTH).optional(),
  kind: z.enum(ORGANIZATION_KINDS).optional(),
  ...common,
});
const revokeSchema = z.strictObject({ "org-slug": slug, email, ...common });
const statusSchema = z.strictObject({ "org-slug": slug, ...common });

function fail(hint: string): ParseResult {
  return { ok: false, hint };
}

// Hints name flags only, never the values, which may be sensitive.
function issueHint(error: z.ZodError): string {
  const parts = error.issues.map((issue) => {
    if (issue.code === "unrecognized_keys") {
      return `flaga niedozwolona w tej komendzie: ${issue.keys.join(", ")}`;
    }
    const flag = issue.path.map(String).join(".");
    return flag === "" ? "nieprawidłowe argumenty" : `nieprawidłowa lub brakująca flaga --${flag}`;
  });
  return [...new Set(parts)].join("; ");
}

export function parseOpsCuratorArgs(
  argv: readonly string[],
  defaultOperator?: string,
): ParseResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: Object.fromEntries(FLAGS.map((flag) => [flag, { type: "string" as const }])),
    });
  } catch {
    return fail("Nieznana flaga lub flaga bez wartości.");
  }

  const raw: Record<string, string | undefined> = { ...parsed.values };
  raw.operator ??= defaultOperator;
  const words = parsed.positionals.join(" ");

  if (words === "grant") {
    const result = grantSchema.safeParse(raw);
    if (!result.success) return fail(issueHint(result.error));
    const v = result.data;
    return {
      ok: true,
      command: {
        kind: "grant",
        orgSlug: v["org-slug"],
        email: v.email.toLowerCase(),
        ...(v.name === undefined ? {} : { name: v.name }),
        ...(v.kind === undefined ? {} : { organizationKind: v.kind }),
        operator: v.operator,
        reason: v.reason,
      },
    };
  }

  if (words === "revoke") {
    const result = revokeSchema.safeParse(raw);
    if (!result.success) return fail(issueHint(result.error));
    const v = result.data;
    return {
      ok: true,
      command: {
        kind: "revoke",
        orgSlug: v["org-slug"],
        email: v.email.toLowerCase(),
        operator: v.operator,
        reason: v.reason,
      },
    };
  }

  if (words === "suspend" || words === "approve") {
    const result = statusSchema.safeParse(raw);
    if (!result.success) return fail(issueHint(result.error));
    const v = result.data;
    return {
      ok: true,
      command: {
        kind: "set-status",
        orgSlug: v["org-slug"],
        status: words === "suspend" ? "suspended" : "approved",
        operator: v.operator,
        reason: v.reason,
      },
    };
  }

  return fail("Nieznana komenda. Dostępne: grant, revoke, suspend, approve.");
}

const REJECTION_HINTS: Record<string, string> = {
  user_not_found:
    "Odmowa: nie ma konta z tym adresem e-mail. Osoba najpierw loguje się sama; konta nie zakładamy.",
  organization_not_found: "Odmowa: nie ma organizacji o tym slugu.",
  kind_mismatch: "Odmowa: organizacja o tym slugu ma inny rodzaj niż podany w --kind.",
  person_member_limit: "Odmowa: organizacja rodzaju person ma już jednego członka.",
  organization_details_required:
    "Błąd wejścia: nowa organizacja wymaga --name i --kind przy pierwszym grant.",
};

export function inputErrorOutput(hint: string): CliOutput {
  return { exitCode: 2, stdout: [], stderr: [`Błąd wejścia: ${hint}`, USAGE] };
}

// Only the SQLSTATE class (first two characters) is shown: messages and SQL
// could carry identifiers or the connection string.
export function errorOutput(error: unknown): CliOutput {
  const code = (error as { code?: unknown } | null)?.code;
  const sqlState = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;

  if (error instanceof Error && error.name === "ServerConfigError") {
    return { exitCode: 1, stdout: [], stderr: [error.message] };
  }

  const line =
    "Operacja przerwana awarią infrastruktury; nic nie zapisano, można ponowić polecenie.";
  const detail =
    sqlState === undefined ? "brak (błąd połączenia lub roli)" : `klasa ${sqlState.slice(0, 2)}`;
  return { exitCode: 1, stdout: [], stderr: [line, `SQLSTATE: ${detail}`] };
}

function finish(result: OpsCuratorResult): CliOutput {
  const rejected = result.outcome === "rejected";
  const detailsMissing = result.code === "organization_details_required";

  return {
    exitCode: rejected ? (detailsMissing ? 2 : 3) : 0,
    stdout: [
      JSON.stringify({
        outcome: result.outcome,
        ...(result.code ? { code: result.code } : {}),
        ...(result.auditId ? { auditId: result.auditId } : {}),
        ...(result.organizationId ? { organizationId: result.organizationId } : {}),
        organizationSlug: result.organizationSlug,
        ...(result.organizationCreated === undefined
          ? {}
          : { organizationCreated: result.organizationCreated }),
        ...(result.userId ? { userId: result.userId } : {}),
        ...(result.status ? { status: result.status } : {}),
      }),
    ],
    stderr: rejected ? [REJECTION_HINTS[result.code ?? ""] ?? "Odmowa domenowa."] : [],
  };
}

export async function executeOpsCuratorCommand(
  command: OpsCuratorCommand,
  gateway: OpsCuratorGateway,
): Promise<CliOutput> {
  const context = { operator: command.operator, reason: command.reason };

  switch (command.kind) {
    case "grant":
      return finish(
        await gateway.grantCurator({
          orgSlug: command.orgSlug,
          email: command.email,
          ...(command.name === undefined ? {} : { name: command.name }),
          ...(command.organizationKind === undefined ? {} : { kind: command.organizationKind }),
          ...context,
        }),
      );
    case "revoke":
      return finish(
        await gateway.revokeCurator({ orgSlug: command.orgSlug, email: command.email, ...context }),
      );
    case "set-status":
      return finish(
        await gateway.setOrganizationStatus({
          orgSlug: command.orgSlug,
          status: command.status,
          ...context,
        }),
      );
  }
}

export type OpsCuratorConnection = Readonly<{
  gateway: OpsCuratorGateway;
  close: () => Promise<void>;
}>;

export type OpsCuratorDeps = Readonly<{
  getConnectionString: () => string;
  connect: (connectionString: string) => Promise<OpsCuratorConnection>;
  defaultOperator?: string;
}>;

// Validates before connecting; the connection string is read only afterwards.
export async function runOpsCurator(
  argv: readonly string[],
  deps: OpsCuratorDeps,
): Promise<CliOutput> {
  const parsed = parseOpsCuratorArgs(argv, deps.defaultOperator);
  if (!parsed.ok) return inputErrorOutput(parsed.hint);

  try {
    const connection = await deps.connect(deps.getConnectionString());
    try {
      return await executeOpsCuratorCommand(parsed.command, connection.gateway);
    } finally {
      await connection.close().catch(() => undefined);
    }
  } catch (error) {
    return errorOutput(error);
  }
}
