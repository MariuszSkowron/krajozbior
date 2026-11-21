import { describe, expect, it } from "vitest";

import {
  CURRENT_TERMS_VERSION,
  isAcceptanceGiven,
  isTermsVersion,
} from "@/features/terms/domain/terms-version";

describe("the version of the terms", () => {
  it("has a shape the database CHECK accepts", () => {
    expect(isTermsVersion(CURRENT_TERMS_VERSION)).toBe(true);
  });

  it.each(["0.2", "1", "10.0.1", "1.2.3.4"])("accepts %s", (version) => {
    expect(isTermsVersion(version)).toBe(true);
  });

  it.each(["", "v1", "0.", ".2", "1.2.3.4.5", "1,2", "0.2 ", 0.2, null, undefined])(
    "refuses %j",
    (version) => {
      expect(isTermsVersion(version)).toBe(false);
    },
  );
});

describe("the acceptance field", () => {
  it.each(["on", "true", true])("counts %j as given", (value) => {
    expect(isAcceptanceGiven(value)).toBe(true);
  });

  it.each(["", "off", "false", "1", 1, false, null, undefined, {}])(
    "does not count %j",
    (value) => {
      expect(isAcceptanceGiven(value)).toBe(false);
    },
  );
});
