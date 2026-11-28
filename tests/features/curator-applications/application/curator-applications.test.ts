import { describe, expect, it, vi } from "vitest";

import type {
  CuratorApplicationsDeps,
  CuratorApplicationsRepository,
  FunctionAnswer,
  MyCuratorApplication,
} from "@/features/curator-applications/application/curator-application-types";
import {
  decideCuratorApplication,
  getMyCuratorApplication,
  listCuratorApplications,
  revokeCuratorRole,
  submitCuratorApplication,
  withdrawCuratorApplication,
} from "@/features/curator-applications/application/curator-applications";
import type { Actor } from "@/features/identity/domain/actor";
import { ORGANIZATION_NAME_MESSAGE } from "@/features/organizations/domain/organization";

const user: Actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" };
const admin: Actor = { id: "22222222-2222-4222-8222-222222222222", role: "admin" };
const session = { actor: admin, sessionToken: "token-sesji" };
const applicationId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";

const form = {
  organizationName: "Gmina Rumia",
  organizationKind: "municipality",
  applicantRole: "promocja",
  contact: "promocja@example.com",
  websiteUrl: null,
};

const application: MyCuratorApplication = {
  id: applicationId,
  organizationName: "Gmina Rumia",
  organizationKind: "municipality",
  applicantRole: "promocja",
  contact: "promocja@example.com",
  websiteUrl: null,
  status: "approved",
  createdAt: new Date("2026-11-24T10:00:00Z"),
  rejectionReason: null,
  organizationNameCurrent: "Gmina Rumia",
  isMember: true,
  organizationApproved: true,
};

function setup(overrides: Partial<CuratorApplicationsRepository> = {}, panelEnabled = true) {
  const tx = { em: {} as never };
  const repository: CuratorApplicationsRepository = {
    findLatest: vi.fn(async () => application),
    insert: vi.fn(async () => ({ status: "created", id: applicationId }) as const),
    withdrawLatest: vi.fn(async () => "deleted" as const),
    listForAdmin: vi.fn(async () => []),
    decide: vi.fn(async (): Promise<FunctionAnswer> => ({
      outcome: "applied",
      code: null,
      organizationId,
    })),
    revoke: vi.fn(async (): Promise<FunctionAnswer> => ({
      outcome: "applied",
      code: null,
      organizationId: null,
    })),
    ...overrides,
  };
  const deps = {
    withUserContext: vi.fn(async (_actor, work) => work(tx)),
    withAdminContext: vi.fn(async (_actor, _token, work) => work(tx)),
    limiter: { reserve: vi.fn(async () => ({ allowed: true }) as const) },
    repository,
    panelEnabled: vi.fn(() => panelEnabled),
  } as unknown as CuratorApplicationsDeps & {
    withUserContext: ReturnType<typeof vi.fn>;
    withAdminContext: ReturnType<typeof vi.fn>;
    limiter: { reserve: ReturnType<typeof vi.fn> };
  };

  return { deps, repository };
}

const refused = (code: string): FunctionAnswer => ({
  outcome: "refused",
  code,
  organizationId: null,
});
const dbError = (code: string, message = "db") => Object.assign(new Error(message), { code });
// What `app_require_live_admin` raises (the text is part of the contract with the migration).
const liveAdminRefusal = () =>
  dbError("42501", "select app_x() - a live administrator session is required");

describe("getMyCuratorApplication", () => {
  it("returns the newest application with the state of the screen", async () => {
    const { deps } = setup();

    expect(await getMyCuratorApplication(user, deps)).toEqual({
      status: "ok",
      value: { application, state: "approved_member" },
    });
    expect(deps.withUserContext).toHaveBeenCalledWith(user, expect.any(Function));
  });

  it("answers `none` for an account without applications", async () => {
    const { deps } = setup({ findLatest: vi.fn(async () => null) });

    expect(await getMyCuratorApplication(user, deps)).toEqual({
      status: "ok",
      value: { application: null, state: "none" },
    });
  });

  it("refuses a guest and an administrator before the database", async () => {
    const { deps } = setup();

    expect(await getMyCuratorApplication(null, deps)).toEqual({ status: "unauthenticated" });
    expect(await getMyCuratorApplication(admin, deps)).toEqual({ status: "forbidden" });
    expect(deps.withUserContext).not.toHaveBeenCalled();
  });

  it("does not turn an unexpected error of the role check into a refusal", async () => {
    const { deps } = setup();
    const broken = {
      id: user.id,
      get role(): never {
        throw new Error("unexpected");
      },
    } as unknown as Actor;

    await expect(getMyCuratorApplication(broken, deps)).rejects.toThrow("unexpected");
    expect(deps.withUserContext).not.toHaveBeenCalled();
  });
});

describe("submitCuratorApplication", () => {
  it("creates the application of the actor", async () => {
    const { deps, repository } = setup();

    expect(await submitCuratorApplication(user, form, deps)).toEqual({
      status: "ok",
      value: { id: applicationId },
    });
    expect(repository.insert).toHaveBeenCalledWith(expect.anything(), form);
  });

  it("refuses a guest and an administrator without limiting or opening the database", async () => {
    const { deps } = setup();

    expect(await submitCuratorApplication(null, form, deps)).toEqual({ status: "unauthenticated" });
    expect(await submitCuratorApplication(admin, form, deps)).toEqual({ status: "forbidden" });
    expect(deps.limiter.reserve).not.toHaveBeenCalled();
    expect(deps.withUserContext).not.toHaveBeenCalled();
  });

  it("names the wrong fields and does not touch the limiter", async () => {
    const { deps } = setup();

    expect(await submitCuratorApplication(user, { ...form, contact: "1" }, deps)).toEqual({
      status: "invalid",
      fields: ["contact"],
    });
    expect(deps.limiter.reserve).not.toHaveBeenCalled();
  });

  it("explains a refused organization name (C-05)", async () => {
    const { deps } = setup();

    expect(
      await submitCuratorApplication(user, { ...form, organizationName: "Gmina \u{1f332}" }, deps),
    ).toEqual({
      status: "invalid",
      fields: ["organizationName"],
      message: ORGANIZATION_NAME_MESSAGE,
    });
  });

  it("answers rate_limited when the limiter refuses", async () => {
    const { deps } = setup();

    deps.limiter.reserve.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });

    expect(await submitCuratorApplication(user, form, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 60,
    });
    expect(deps.withUserContext).not.toHaveBeenCalled();
  });

  it.each(["pending_exists", "too_many_applications"] as const)(
    "maps the answer %s of the repository to a conflict",
    async (code) => {
      const { deps } = setup({ insert: vi.fn(async () => ({ status: code })) });

      expect(await submitCuratorApplication(user, form, deps)).toEqual({
        status: "conflict",
        code,
      });
    },
  );

  it.each([
    ["23505", "pending_exists"],
    ["42501", "too_many_applications"],
  ])("maps the race error %s to the conflict %s", async (state, code) => {
    const { deps } = setup({
      insert: vi.fn(async () => {
        throw dbError(state);
      }),
    });

    expect(await submitCuratorApplication(user, form, deps)).toEqual({ status: "conflict", code });
  });

  it("rethrows another database error, also one without a code", async () => {
    for (const error of [dbError("57014"), new Error("plain"), null]) {
      const { deps } = setup({
        insert: vi.fn(async () => {
          throw error;
        }),
      });

      await expect(submitCuratorApplication(user, form, deps)).rejects.toBe(error);
    }
  });
});

describe("withdrawCuratorApplication", () => {
  it.each([
    ["deleted", { status: "ok", value: null }],
    ["not_found", { status: "not_found" }],
    ["already_decided", { status: "conflict", code: "already_decided" }],
  ] as const)("maps %s", async (result, expected) => {
    const { deps } = setup({ withdrawLatest: vi.fn(async () => result) });

    expect(await withdrawCuratorApplication(user, deps)).toEqual(expected);
  });

  it("refuses a guest and an administrator, and honours the limiter", async () => {
    const { deps } = setup();

    expect(await withdrawCuratorApplication(null, deps)).toEqual({ status: "unauthenticated" });
    expect(await withdrawCuratorApplication(admin, deps)).toEqual({ status: "forbidden" });

    deps.limiter.reserve.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 5 });
    expect(await withdrawCuratorApplication(user, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 5,
    });
  });
});

describe("the use cases of the administrator", () => {
  it("answer not_found while the panel is off, before anything is read", async () => {
    const { deps } = setup({}, false);

    expect(await listCuratorApplications(session, "pending", deps)).toEqual({
      status: "not_found",
    });
    expect(
      await decideCuratorApplication(
        session,
        applicationId,
        { decision: "reject", reason: "x" },
        deps,
      ),
    ).toEqual({ status: "not_found" });
    expect(await revokeCuratorRole(session, applicationId, { reason: "x" }, deps)).toEqual({
      status: "not_found",
    });
    expect(deps.withAdminContext).not.toHaveBeenCalled();
    expect(deps.limiter.reserve).not.toHaveBeenCalled();
  });

  it("refuse a guest, a user and a curator (a user) before the database", async () => {
    const { deps } = setup();

    for (const call of [
      (who: typeof session | null) => listCuratorApplications(who, "pending", deps),
      (who: typeof session | null) =>
        decideCuratorApplication(who, applicationId, { decision: "reject", reason: "x" }, deps),
      (who: typeof session | null) => revokeCuratorRole(who, applicationId, { reason: "x" }, deps),
    ]) {
      expect(await call(null)).toEqual({ status: "unauthenticated" });
      expect(await call({ actor: user, sessionToken: "t" })).toEqual({ status: "forbidden" });
    }
    expect(deps.withAdminContext).not.toHaveBeenCalled();
  });

  it("map 42501 (no live session) to unauthenticated and 22023 to invalid, rethrow the rest", async () => {
    for (const [make, expected] of [
      [liveAdminRefusal, { status: "unauthenticated" }],
      [() => dbError("22023"), { status: "invalid" }],
    ] as const) {
      const failing = async () => {
        throw make();
      };
      const { deps } = setup({ listForAdmin: failing, decide: failing, revoke: failing });

      expect(await listCuratorApplications(session, "pending", deps)).toEqual(expected);
      expect(
        await decideCuratorApplication(
          session,
          applicationId,
          { decision: "reject", reason: "x" },
          deps,
        ),
      ).toEqual(expected);
      expect(await revokeCuratorRole(session, applicationId, { reason: "x" }, deps)).toEqual(
        expected,
      );
    }

    const { deps } = setup({
      listForAdmin: async () => {
        throw dbError("57014");
      },
    });

    await expect(listCuratorApplications(session, "pending", deps)).rejects.toMatchObject({
      code: "57014",
    });
  });

  it("does not take every 42501 for a signed-out administrator", async () => {
    // A policy refusal inside a function has another text: a server error, not unauthenticated.
    for (const error of [
      dbError("42501"),
      dbError("42501", "new row violates row-level security"),
      { code: "42501" },
    ]) {
      const failing = async () => {
        throw error;
      };
      const { deps } = setup({ listForAdmin: failing, decide: failing, revoke: failing });

      await expect(listCuratorApplications(session, "pending", deps)).rejects.toBe(error);
      await expect(
        decideCuratorApplication(session, applicationId, { decision: "reject", reason: "x" }, deps),
      ).rejects.toBe(error);
      await expect(revokeCuratorRole(session, applicationId, { reason: "x" }, deps)).rejects.toBe(
        error,
      );
    }
  });
});

describe("listCuratorApplications", () => {
  it("lists one status with the token of the session", async () => {
    const { deps, repository } = setup();

    expect(await listCuratorApplications(session, "approved", deps)).toEqual({
      status: "ok",
      value: [],
    });
    expect(deps.withAdminContext).toHaveBeenCalledWith(admin, "token-sesji", expect.any(Function));
    expect(repository.listForAdmin).toHaveBeenCalledWith(expect.anything(), "approved");
  });

  it.each(["pending", "approved", "rejected"])("accepts the status %s", async (status) => {
    const { deps } = setup();

    expect((await listCuratorApplications(session, status, deps)).status).toBe("ok");
  });

  it.each(["done", 5, undefined])("refuses the status %j", async (status) => {
    const { deps } = setup();

    expect(await listCuratorApplications(session, status, deps)).toEqual({ status: "invalid" });
    expect(deps.withAdminContext).not.toHaveBeenCalled();
  });
});

describe("decideCuratorApplication", () => {
  const approveExisting = { decision: "approve", organizationId };

  it("approves and returns the organization", async () => {
    const { deps, repository } = setup();

    expect(await decideCuratorApplication(session, applicationId, approveExisting, deps)).toEqual({
      status: "ok",
      value: { organizationId },
    });
    expect(repository.decide).toHaveBeenCalledWith(expect.anything(), applicationId, {
      decision: "approve",
      target: { kind: "existing", organizationId },
    });
    expect(deps.limiter.reserve).toHaveBeenCalledTimes(2);
  });

  it("rejects with a reason; a rejection counts only against the decision limit", async () => {
    const { deps } = setup();

    expect(
      await decideCuratorApplication(
        session,
        applicationId,
        { decision: "reject", reason: "Nie znamy" },
        deps,
      ),
    ).toEqual({ status: "ok", value: { organizationId } });
    expect(deps.limiter.reserve).toHaveBeenCalledTimes(1);
  });

  it("answers not_found for an identifier that is no UUID, without the database", async () => {
    const { deps } = setup();

    expect(await decideCuratorApplication(session, "nope", approveExisting, deps)).toEqual({
      status: "not_found",
    });
    expect(deps.withAdminContext).not.toHaveBeenCalled();
  });

  it("answers invalid for a body that is no decision", async () => {
    const { deps } = setup();

    expect(await decideCuratorApplication(session, applicationId, { decision: "x" }, deps)).toEqual(
      {
        status: "invalid",
      },
    );
    expect(deps.limiter.reserve).not.toHaveBeenCalled();
  });

  it("spends no approval slot when the decision limit refuses (decision limit first)", async () => {
    const { deps } = setup();

    deps.limiter.reserve.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 9 });
    expect(await decideCuratorApplication(session, applicationId, approveExisting, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 9,
    });
    expect(deps.limiter.reserve).toHaveBeenCalledTimes(1);
    expect(deps.limiter.reserve).toHaveBeenCalledWith(
      "curator_application_decide",
      session.actor.id,
      expect.anything(),
    );

    deps.limiter.reserve.mockReset();
    deps.limiter.reserve
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3 });
    expect(await decideCuratorApplication(session, applicationId, approveExisting, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 3,
    });
    expect(deps.withAdminContext).not.toHaveBeenCalled();
  });

  it.each([
    "not_pending",
    "slug_taken",
    "organization_exists",
    "kind_mismatch",
    "admin_cannot_be_member",
    "organization_not_found",
  ])("maps the refusal %s to a conflict", async (code) => {
    const answer: FunctionAnswer = { outcome: "refused", code, organizationId: null };
    const { deps } = setup({ decide: vi.fn(async () => answer) });

    expect(await decideCuratorApplication(session, applicationId, approveExisting, deps)).toEqual({
      status: "conflict",
      code,
    });
  });

  it("maps not_found of the function and refuses a code it does not know", async () => {
    const { deps } = setup({
      decide: vi.fn(async () => refused("not_found")),
    });

    expect(await decideCuratorApplication(session, applicationId, approveExisting, deps)).toEqual({
      status: "not_found",
    });

    const unknown = setup({
      decide: vi.fn(async () => refused("surprise")),
    });

    await expect(
      decideCuratorApplication(session, applicationId, approveExisting, unknown.deps),
    ).rejects.toThrow("Unexpected answer");
  });
});

describe("revokeCuratorRole", () => {
  it("takes the role with a reason and counts against the decision limit", async () => {
    const { deps, repository } = setup();

    expect(await revokeCuratorRole(session, applicationId, { reason: " Koniec " }, deps)).toEqual({
      status: "ok",
      value: { organizationId: null },
    });
    expect(repository.revoke).toHaveBeenCalledWith(expect.anything(), applicationId, "Koniec");
    expect(deps.limiter.reserve).toHaveBeenCalledTimes(1);
  });

  it("answers not_found for an identifier that is no UUID", async () => {
    const { deps } = setup();

    expect(await revokeCuratorRole(session, "x", { reason: "a" }, deps)).toEqual({
      status: "not_found",
    });
  });

  it.each([null, "text", {}, { reason: "" }, { reason: "a@b.pl" }, { reason: 5 }])(
    "refuses the body %j",
    async (body) => {
      const { deps } = setup();

      expect(await revokeCuratorRole(session, applicationId, body, deps)).toEqual({
        status: "invalid",
      });
      expect(deps.withAdminContext).not.toHaveBeenCalled();
    },
  );

  it("honours the limiter and maps not_member", async () => {
    const { deps } = setup({
      revoke: vi.fn(async () => refused("not_member")),
    });

    expect(await revokeCuratorRole(session, applicationId, { reason: "a" }, deps)).toEqual({
      status: "conflict",
      code: "not_member",
    });

    deps.limiter.reserve.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 7 });
    expect(await revokeCuratorRole(session, applicationId, { reason: "a" }, deps)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 7,
    });
  });
});
