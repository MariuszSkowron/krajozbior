import { describe, expect, it, vi } from "vitest";

import {
  acceptCurrentTerms,
  hasAcceptedCurrentTerms,
  hasEverAcceptedTerms,
} from "@/features/terms/application/terms";
import type { TermsDeps } from "@/features/terms/application/terms-types";
import { CURRENT_TERMS_VERSION } from "@/features/terms/domain/terms-version";

const actor = { id: "11111111-1111-4111-8111-111111111111", role: "user" } as const;

function makeDeps(accepted = false) {
  const tx = {} as never;
  const hasAccepted = vi.fn(async () => accepted);
  const hasAnyAcceptance = vi.fn(async () => accepted);
  const accept = vi.fn(async () => undefined);
  const withUserContext = vi.fn(async (_actor: unknown, work: (tx: never) => Promise<unknown>) =>
    work(tx),
  );

  return {
    deps: {
      withUserContext,
      repository: { hasAccepted, hasAnyAcceptance, accept },
    } as unknown as TermsDeps,
    hasAccepted,
    hasAnyAcceptance,
    accept,
    withUserContext,
    tx,
  };
}

describe("hasAcceptedCurrentTerms", () => {
  it.each([true, false])(
    "answers %s from the repository for the current version",
    async (value) => {
      const { deps, hasAccepted, withUserContext, tx } = makeDeps(value);

      expect(await hasAcceptedCurrentTerms(actor, deps)).toEqual({ status: "ok", value });
      expect(withUserContext).toHaveBeenCalledWith(actor, expect.any(Function));
      expect(hasAccepted).toHaveBeenCalledWith(tx, CURRENT_TERMS_VERSION);
    },
  );

  it("turns a guest away before the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await hasAcceptedCurrentTerms(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });

  it("works the same for an administrator (they pass the same screen)", async () => {
    const { deps } = makeDeps(true);

    expect(await hasAcceptedCurrentTerms({ ...actor, role: "admin" }, deps)).toEqual({
      status: "ok",
      value: true,
    });
  });
});

describe("hasEverAcceptedTerms", () => {
  it.each([true, false])("answers %s from the repository for any version", async (value) => {
    const { deps, hasAnyAcceptance, tx } = makeDeps(value);

    expect(await hasEverAcceptedTerms(actor, deps)).toEqual({ status: "ok", value });
    expect(hasAnyAcceptance).toHaveBeenCalledWith(tx);
  });

  it("turns a guest away before the database", async () => {
    const { deps, withUserContext } = makeDeps();

    expect(await hasEverAcceptedTerms(null, deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
  });
});

describe("acceptCurrentTerms", () => {
  it.each(["on", "true", true])(
    "records the current version when the field is %j",
    async (field) => {
      const { deps, accept, tx } = makeDeps();

      expect(await acceptCurrentTerms(actor, field, deps)).toEqual({ status: "ok", value: null });
      expect(accept).toHaveBeenCalledExactlyOnceWith(tx, CURRENT_TERMS_VERSION);
    },
  );

  it.each(["", "off", undefined, null, false])(
    "records nothing and answers invalid when the field is %j",
    async (field) => {
      const { deps, accept, withUserContext } = makeDeps();

      expect(await acceptCurrentTerms(actor, field, deps)).toEqual({ status: "invalid" });
      expect(withUserContext).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
    },
  );

  it("turns a guest away before anything else, whatever the field is", async () => {
    const { deps, withUserContext, accept } = makeDeps();

    expect(await acceptCurrentTerms(null, "on", deps)).toEqual({ status: "unauthenticated" });
    expect(withUserContext).not.toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();
  });
});
