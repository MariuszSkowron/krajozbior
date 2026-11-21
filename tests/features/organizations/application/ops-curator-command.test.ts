import { describe, expect, it, vi } from "vitest";

import {
  errorOutput,
  executeOpsCuratorCommand,
  inputErrorOutput,
  parseOpsCuratorArgs,
  runOpsCurator,
} from "@/features/organizations/application/ops-curator-command";
import type {
  OpsCuratorGateway,
  OpsCuratorResult,
} from "@/features/organizations/application/ops-curator-types";

const base = ["--org-slug", "gmina-a", "--reason", "Wniosek 12"];

function gateway(result: OpsCuratorResult): OpsCuratorGateway {
  return {
    grantCurator: vi.fn(async () => result),
    revokeCurator: vi.fn(async () => result),
    setOrganizationStatus: vi.fn(async () => result),
  };
}

describe("ops:curator argument parsing", () => {
  it("parses grant with optional creation details and lowercases the e-mail", () => {
    const parsed = parseOpsCuratorArgs(
      [
        "grant",
        ...base,
        "--email",
        "Ola@Example.com",
        "--name",
        " Gmina A ",
        "--kind",
        "municipality",
      ],
      "operator-1",
    );

    expect(parsed).toEqual({
      ok: true,
      command: {
        kind: "grant",
        orgSlug: "gmina-a",
        email: "ola@example.com",
        name: "Gmina A",
        organizationKind: "municipality",
        operator: "operator-1",
        reason: "Wniosek 12",
      },
    });
  });

  it("parses grant without details, revoke, suspend and approve", () => {
    expect(
      parseOpsCuratorArgs(["grant", ...base, "--email", "a@b.pl", "--operator", "x"]),
    ).toMatchObject({
      ok: true,
      command: { kind: "grant", operator: "x" },
    });
    expect(parseOpsCuratorArgs(["revoke", ...base, "--email", "a@b.pl"], "op")).toMatchObject({
      ok: true,
      command: { kind: "revoke", email: "a@b.pl" },
    });
    expect(parseOpsCuratorArgs(["suspend", ...base], "op")).toMatchObject({
      ok: true,
      command: { kind: "set-status", status: "suspended" },
    });
    expect(parseOpsCuratorArgs(["approve", ...base], "op")).toMatchObject({
      ok: true,
      command: { kind: "set-status", status: "approved" },
    });
  });

  it("refuses bad input with a hint that names flags, not values", () => {
    const missingReason = parseOpsCuratorArgs(
      ["grant", "--org-slug", "a", "--email", "a@b.pl"],
      "op",
    );
    const badSlug = parseOpsCuratorArgs(
      ["grant", "--org-slug", "Zly Slug", "--email", "a@b.pl", "--reason", "x"],
      "op",
    );
    const extra = parseOpsCuratorArgs(["suspend", ...base, "--email", "a@b.pl"], "op");
    const noOperator = parseOpsCuratorArgs(["suspend", ...base]);

    for (const result of [missingReason, badSlug, extra, noOperator]) {
      expect(result.ok).toBe(false);
    }
    expect(missingReason).toEqual({
      ok: false,
      hint: "nieprawidłowa lub brakująca flaga --reason",
    });
    expect(JSON.stringify(badSlug)).not.toContain("Zly Slug");
    expect(extra).toEqual({ ok: false, hint: "flaga niedozwolona w tej komendzie: email" });
    expect(parseOpsCuratorArgs(["grant", "--bogus"], "op")).toEqual({
      ok: false,
      hint: "Nieznana flaga lub flaga bez wartości.",
    });
    expect(parseOpsCuratorArgs(["nope"], "op")).toMatchObject({ ok: false });
    expect(
      parseOpsCuratorArgs(["suspend", "--org-slug", "a", "--reason", "a\nb"], "op"),
    ).toMatchObject({ ok: false });
    // DB-8: the audit is permanent, so no e-mail address in the reason (and none echoed back).
    const withAddress = parseOpsCuratorArgs(
      ["suspend", "--org-slug", "a", "--reason", "Skarga od jan@example.com"],
      "op",
    );

    expect(withAddress).toEqual({ ok: false, hint: "nieprawidłowa lub brakująca flaga --reason" });
  });
});

describe("ops:curator results and exit codes", () => {
  const command = {
    kind: "grant",
    orgSlug: "gmina-a",
    email: "a@b.pl",
    operator: "op",
    reason: "r",
  } as const;

  it("exit 0 with JSON that holds no e-mail for applied and noop", async () => {
    const applied = await executeOpsCuratorCommand(
      command,
      gateway({
        outcome: "applied",
        auditId: "audit-1",
        organizationId: "org-1",
        organizationSlug: "gmina-a",
        organizationCreated: true,
        userId: "user-1",
        status: "approved",
      }),
    );
    const noop = await executeOpsCuratorCommand(
      command,
      gateway({ outcome: "noop", organizationSlug: "gmina-a" }),
    );

    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout[0])).toMatchObject({ outcome: "applied", userId: "user-1" });
    expect(applied.stdout[0]).not.toContain("a@b.pl");
    expect(noop).toMatchObject({ exitCode: 0, stderr: [] });
  });

  it("exit 3 for a domain refusal, exit 2 when creation details are missing", async () => {
    const refused = await executeOpsCuratorCommand(
      command,
      gateway({ outcome: "rejected", code: "user_not_found", organizationSlug: "gmina-a" }),
    );
    const details = await executeOpsCuratorCommand(
      command,
      gateway({
        outcome: "rejected",
        code: "organization_details_required",
        organizationSlug: "gmina-a",
      }),
    );
    const unknown = await executeOpsCuratorCommand(
      command,
      gateway({ outcome: "rejected", organizationSlug: "gmina-a" }),
    );

    expect(refused.exitCode).toBe(3);
    expect(refused.stderr[0]).toContain("Odmowa");
    expect(details.exitCode).toBe(2);
    expect(unknown).toMatchObject({ exitCode: 3, stderr: ["Odmowa domenowa."] });
  });

  it("routes revoke and status commands to the gateway", async () => {
    const result: OpsCuratorResult = { outcome: "noop", organizationSlug: "gmina-a" };
    const target = gateway(result);

    await executeOpsCuratorCommand(
      { kind: "revoke", orgSlug: "gmina-a", email: "a@b.pl", operator: "op", reason: "r" },
      target,
    );
    await executeOpsCuratorCommand(
      { kind: "set-status", orgSlug: "gmina-a", status: "suspended", operator: "op", reason: "r" },
      target,
    );
    await executeOpsCuratorCommand(
      { ...command, name: "Gmina A", organizationKind: "municipality" },
      target,
    );

    expect(target.revokeCurator).toHaveBeenCalledOnce();
    expect(target.setOrganizationStatus).toHaveBeenCalledOnce();
    expect(target.grantCurator).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Gmina A", kind: "municipality" }),
    );
  });

  it("maps errors to exit 1 showing only the SQLSTATE class", () => {
    expect(errorOutput(Object.assign(new Error("secret"), { code: "55P03" }))).toEqual({
      exitCode: 1,
      stdout: [],
      stderr: expect.arrayContaining(["SQLSTATE: klasa 55"]),
    });
    expect(errorOutput(new Error("secret")).stderr[1]).toContain("brak");
    expect(errorOutput(null).exitCode).toBe(1);
    const config = new Error("Invalid server configuration: X");

    config.name = "ServerConfigError";
    expect(errorOutput(config)).toEqual({ exitCode: 1, stdout: [], stderr: [config.message] });
    expect(inputErrorOutput("zle").exitCode).toBe(2);
  });

  it("validates before connecting and closes the connection", async () => {
    const connect = vi.fn();

    expect(
      (await runOpsCurator(["grant"], { getConnectionString: () => "x", connect })).exitCode,
    ).toBe(2);
    expect(connect).not.toHaveBeenCalled();

    const close = vi.fn(async () => undefined);
    const output = await runOpsCurator(["suspend", ...base], {
      getConnectionString: () => "postgres://x",
      connect: async () => ({
        gateway: gateway({ outcome: "noop", organizationSlug: "gmina-a" }),
        close,
      }),
      defaultOperator: "op",
    });

    expect(output.exitCode).toBe(0);
    expect(close).toHaveBeenCalledOnce();

    const failing = await runOpsCurator(["suspend", ...base], {
      getConnectionString: () => "postgres://x",
      connect: async () => {
        throw new Error("down");
      },
      defaultOperator: "op",
    });

    expect(failing.exitCode).toBe(1);
  });
});
