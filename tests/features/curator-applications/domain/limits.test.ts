import { describe, expect, it } from "vitest";

import { assertValidLimit } from "@/features/identity/domain/action-rate-limit";
import {
  curatorApplicationApproveLimit,
  curatorApplicationDecideLimit,
  curatorApplicationSubmitLimit,
  curatorApplicationWithdrawLimit,
} from "@/features/curator-applications/domain/limits";

describe("limits of the curator applications", () => {
  it.each([
    curatorApplicationSubmitLimit,
    curatorApplicationWithdrawLimit,
    curatorApplicationApproveLimit,
    curatorApplicationDecideLimit,
  ])("fits the storage of the action limiter: %j", (limit) => {
    expect(() => assertValidLimit(limit)).not.toThrow();
  });

  it("keeps the approvals below all decisions of an administrator", () => {
    expect(curatorApplicationApproveLimit.limit).toBeLessThan(curatorApplicationDecideLimit.limit);
  });
});
