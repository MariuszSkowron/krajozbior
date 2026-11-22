import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

// Każdy test uruchamia osobny proces PowerShell (1-3 s, przy obciążonym komputerze kilka razy
// dłużej), więc domyślne 5 s nie wystarcza. Limit dotyczy tylko tego pliku.
vi.setConfig({ testTimeout: 30_000 });

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

  // Each case starts a separate PowerShell process (about 1 s on CI), so each gets its own test
  // and a generous timeout. Only the refusal (non-zero exit code) is checked, not the message,
  // which differs between Windows PowerShell 5.1 and pwsh.
  it.each([
    ["number zero", ["-Pr", "0", "-DryRun"]],
    ["non-numeric PR", ["-Pr", "abc", "-DryRun"]],
    ["unknown state", ["-Pr", "41", "-State", "pending", "-DryRun"]],
    ["unknown status name", ["-Pr", "41", "-Only", "other", "-DryRun"]],
    ["carry-over with failure", ["-Pr", "41", "-CarryOver", "-State", "failure", "-DryRun"]],
    ["missing PR", ["-DryRun"]],
  ])(
    "refuses bad parameters: %s",
    (_name, args) => {
      expect(run(args as string[]).code).not.toBe(0);
    },
    30_000,
  );
});
