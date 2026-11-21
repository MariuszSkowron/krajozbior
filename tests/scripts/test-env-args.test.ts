import { describe, expect, it } from "vitest";

import { ArgsError, validateExtraArgs } from "../../scripts/test-env/test-env-args.mjs";

describe("test-env-test.ps1 extra arguments", () => {
  it("passes nothing through when no extra arguments are given", () => {
    expect(validateExtraArgs("e2e", [])).toEqual([]);
    expect(validateExtraArgs("all", [])).toEqual([]);
  });

  it("accepts e2e spec files, a -g filter and --output", () => {
    const args = [
      "e2e/nearby.spec.ts",
      "e2e/login.spec.ts",
      "-g",
      "karta:sciezka",
      "--output",
      ".ai/tmp/x/out",
    ];
    expect(validateExtraArgs("e2e", args)).toEqual(args);
  });

  it("accepts integration test files and a -t filter", () => {
    const args = ["tests/integration/foo.test.ts", "-t", "odmowa"];
    expect(validateExtraArgs("integration", args)).toEqual(args);
  });

  it.each([
    ["e2e", ["--ui"]],
    ["e2e", ["--config=evil.ts"]],
    ["e2e", ["../e2e/a.spec.ts"]],
    ["e2e", ["e2e/../src/a.spec.ts"]],
    ["e2e", ["/etc/e2e/a.spec.ts"]],
    ["e2e", ["C:/x/e2e/a.spec.ts"]],
    ["e2e", ["e2e/a.test.ts"]],
    ["e2e", ["e2e/a.spec.ts;calc"]],
    ["e2e", ["e2e/a b.spec.ts"]],
    ["e2e", ["tests/integration/a.test.ts"]],
    ["e2e", ["-g"]],
    ["e2e", ["-g", "a&b"]],
    ["e2e", ["-g", "--ui"]],
    ["e2e", ["--output", "../out"]],
    ["integration", ["--output", "x"]],
    ["integration", ["-g", "x"]],
    ["integration", ["e2e/a.spec.ts"]],
    ["integration", ["tests/a.spec.ts"]],
    ["integration", ["--config", "x"]],
    ["all", ["e2e/a.spec.ts"]],
  ])("rejects %s %j", (suite, args) => {
    expect(() => validateExtraArgs(suite, args)).toThrow(ArgsError);
  });
});
