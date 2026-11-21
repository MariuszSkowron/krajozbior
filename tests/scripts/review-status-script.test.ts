import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// scripts/review-status.ps1: only the dry run is exercised, so nothing talks to
// GitHub and no token is needed.
const script = "scripts/review-status.ps1";
const shell = ["powershell", "pwsh"].find(
  (name) => spawnSync(name, ["-NoProfile", "-Command", "exit 0"]).status === 0,
);

function run(args: string[]) {
  const result = spawnSync(
    shell!,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    { encoding: "utf8" },
  );
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

describe("review-status.ps1 source", () => {
  const source = readFileSync(script, "utf8");

  it("keeps the file ASCII so Windows PowerShell 5.1 reads it correctly", () => {
    expect(/^[\x00-\x7f]*$/.test(source)).toBe(true);
  });

  it("never reads or prints the token", () => {
    expect(source).not.toMatch(/auth token|auth status|git credential/);
  });
});

describe.skipIf(!shell)("review-status.ps1 dry run", () => {
  it("builds the gh api call for both statuses without calling GitHub", () => {
    const { code, out } = run(["-Pr", "41", "-DryRun"]);
    expect(code).toBe(0);
    expect(out).toContain("PR #41 -> <SHA>");
    expect(out).toContain("repos/MariuszSkowron/krajozbior/statuses/<SHA>");
    expect(out).toContain("state=success");
    expect(out).toContain("context=agent-review");
    expect(out).toContain("context=security-review");
  });

  it("limits to one status and supports failure", () => {
    const { code, out } = run([
      "-Pr",
      "41",
      "-Only",
      "security-review",
      "-State",
      "failure",
      "-DryRun",
    ]);
    expect(code).toBe(0);
    expect(out).toContain("state=failure");
    expect(out).toContain("context=security-review");
    expect(out).not.toContain("context=agent-review");
  });

  it("appends the carry-over note", () => {
    const { out } = run(["-Pr", "41", "-CarryOver", "-DryRun"]);
    expect(out).toContain("przeniesione po aktualizacji z main");
  });

  it("handles several PRs", () => {
    const { out } = run(["-Pr", "38,40", "-DryRun"]);
    expect(out).toContain("PR #38");
    expect(out).toContain("PR #40");
  });

  it("refuses bad parameters", () => {
    expect(run(["-Pr", "0", "-DryRun"]).code).not.toBe(0);
    expect(run(["-Pr", "abc", "-DryRun"]).code).not.toBe(0);
    expect(run(["-Pr", "41", "-State", "pending", "-DryRun"]).code).not.toBe(0);
    expect(run(["-Pr", "41", "-Only", "other", "-DryRun"]).code).not.toBe(0);
    expect(run(["-Pr", "41", "-CarryOver", "-State", "failure", "-DryRun"]).code).not.toBe(0);
    expect(run(["-DryRun"]).code).not.toBe(0);
  });
});
