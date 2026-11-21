import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  RESERVED_PORTS,
  SLOT_COUNT,
  StationError,
  containerNames,
  containersToRemove,
  isMainCheckout,
  normalizeStation,
  resolveStation,
  runCli,
  stationConfig,
  stationPorts,
  stationSlot,
} from "../../scripts/test-env/test-env-station.mjs";

// Station naming of scripts/test-env/ (A2): two checkouts must be able to run test
// environments side by side, and test-env-down.ps1 may remove only its own containers.
// Pure logic; nothing here talks to Docker.

const LEGACY_NAMES = ["krajozbior-testenv-e2e-pg", "krajozbior-testenv-int-pg"];
const FOREIGN_NAMES = [
  "krajozbior-showcase-app",
  "krajozbior-showcase-db",
  "krajozbior-db-1",
  "postgres",
  ...LEGACY_NAMES,
];

function checkout(kind: "main" | "worktree" | "none", name = "ws-3") {
  const root = join(mkdtempSync(join(tmpdir(), "test-env-station-")), name);
  mkdirSync(root);
  if (kind === "main") mkdirSync(join(root, ".git"));
  if (kind === "worktree") writeFileSync(join(root, ".git"), "gitdir: elsewhere\n");
  return root;
}

describe("station of a checkout", () => {
  it("is 'main' for the main checkout and the folder name for a worktree", () => {
    const main = checkout("main", "krajozbior");
    const worktree = checkout("worktree", "ws-3");

    expect(isMainCheckout(main)).toBe(true);
    expect(isMainCheckout(worktree)).toBe(false);
    expect(isMainCheckout(checkout("none"))).toBe(false);
    expect(resolveStation({ root: main, mainCheckout: true })).toBe("main");
    expect(resolveStation({ root: worktree, mainCheckout: false })).toBe("ws-3");
  });

  it("normalizes folder names into a short slug", () => {
    expect(resolveStation({ root: "C:/x/.worktrees/WS_7", mainCheckout: false })).toBe("ws-7");
    expect(normalizeStation("Agent  abc.123")).toBe("agent-abc-123");
    expect(normalizeStation("a".repeat(40))).toHaveLength(32);
    expect(normalizeStation(`${"b".repeat(31)}-tail`)).toBe("b".repeat(31));
  });

  it("lets TEST_ENV_STATION override the checkout, but only with a valid name", () => {
    expect(resolveStation({ root: "/x/ws-1", override: "probe-2", mainCheckout: false })).toBe(
      "probe-2",
    );
    expect(resolveStation({ root: "/x/ws-1", override: "  ", mainCheckout: true })).toBe("main");
    expect(() => normalizeStation("---")).toThrow(StationError);
    expect(() => normalizeStation("")).toThrow(StationError);
  });
});

describe("ports of a station", () => {
  it("keeps the main checkout on the ports it used before stations existed", () => {
    expect(stationPorts(stationSlot("main"))).toEqual({
      app: 3100,
      integration: 55432,
      e2e: 55433,
    });
  });

  it("gives ws-N its own slot N, so ws-1 and ws-2 never share a port", () => {
    expect(stationSlot("ws-1")).toBe(1);
    expect(stationSlot("ws-2")).toBe(2);
    expect(stationSlot("ws-49")).toBe(49);
    expect(stationPorts(1)).toEqual({ app: 3101, integration: 55442, e2e: 55443 });
    expect(stationPorts(2)).toEqual({ app: 3102, integration: 55452, e2e: 55453 });
  });

  it("hashes any other name into the upper half, the same way every time", () => {
    for (const station of ["ws-50", "ws-0", "agent-a1b2c3", "probe-2", "krajozbior-dev"]) {
      const slot = stationSlot(station);

      expect(slot, station).toBeGreaterThanOrEqual(50);
      expect(slot, station).toBeLessThan(SLOT_COUNT);
      expect(stationSlot(station), station).toBe(slot);
    }
  });

  it("never uses 3000, 3300 or 5432 and never reuses a port between slots", () => {
    const seen = new Set<number>();

    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const ports = Object.values(stationPorts(slot));

      for (const port of ports) {
        expect(RESERVED_PORTS, `slot ${slot}`).not.toContain(port);
        expect(seen.has(port), `port ${port}`).toBe(false);
        seen.add(port);
      }
    }
    expect(seen.size).toBe(3 * SLOT_COUNT);
    expect(() => stationPorts(SLOT_COUNT)).toThrow(StationError);
    expect(() => stationPorts(-1)).toThrow(StationError);
  });
});

describe("containers of a station", () => {
  it("names both containers after the station", () => {
    expect(containerNames("ws-1")).toEqual({
      e2e: "krajozbior-testenv-ws-1-e2e-pg",
      integration: "krajozbior-testenv-ws-1-int-pg",
    });
  });

  it("never produces a name of another station, of the old scripts or of the local demo", () => {
    const stations = ["main", "ws-1", "ws-2", "ws-12", "e2e", "int", "agent-x"];
    const all = stations.flatMap((station) => Object.values(containerNames(station)));

    expect(new Set(all).size).toBe(all.length);
    for (const name of all) {
      expect(FOREIGN_NAMES).not.toContain(name);
      expect(name).not.toMatch(/showcase/);
    }
  });

  it("lets down remove only exact names of its own station", () => {
    const existing = [
      ...FOREIGN_NAMES,
      ...Object.values(containerNames("ws-2")),
      ...Object.values(containerNames("ws-12")),
      "krajozbior-testenv-ws-1-e2e-pg-copy",
      "x-krajozbior-testenv-ws-1-int-pg",
      " krajozbior-testenv-ws-1-int-pg ",
      "krajozbior-testenv-ws-1-e2e-pg",
      "krajozbior-testenv-ws-1-e2e-pg",
    ];

    expect(containersToRemove(existing, "ws-1")).toEqual([
      "krajozbior-testenv-ws-1-int-pg",
      "krajozbior-testenv-ws-1-e2e-pg",
    ]);
    expect(containersToRemove(FOREIGN_NAMES, "main")).toEqual([]);
    expect(containersToRemove([], "ws-1")).toEqual([]);
  });
});

describe("CLI used by the PowerShell scripts", () => {
  it("prints the station config as JSON", () => {
    const root = checkout("worktree", "ws-4");
    const config = JSON.parse(runCli(["config", "--root", root], { env: {} }));

    expect(config).toEqual(stationConfig({ root, mainCheckout: false }));
    expect(config).toMatchObject({
      station: "ws-4",
      slot: 4,
      ports: { app: 3104, integration: 55472, e2e: 55473 },
      stateDir: ".data/test-env/ws-4",
      label: "krajozbior.testenv.station=ws-4",
    });
  });

  it("honours TEST_ENV_STATION and filters names with `own`", () => {
    const root = checkout("worktree", "ws-4");
    const own = runCli(
      ["own", "krajozbior-testenv-ws-4-int-pg", "krajozbior-testenv-probe-int-pg", "--root", root],
      { env: { TEST_ENV_STATION: "probe" } },
    );

    expect(own).toBe("krajozbior-testenv-probe-int-pg\n");
    expect(runCli(["own", "--root", root], { env: {} })).toBe("");
    expect(() => runCli(["remove-all", "--root", root], { env: {} })).toThrow(StationError);
  });
});

describe("PowerShell scripts follow the station rules", () => {
  const script = (name: string) =>
    readFileSync(join(process.cwd(), "scripts/test-env", name), "utf8");

  it("takes names and ports only from the station tool", () => {
    for (const name of ["test-env-up.ps1", "test-env-down.ps1", "test-env-test.ps1"]) {
      const text = script(name);

      expect(text, name).toContain("test-env-lib.ps1");
      expect(text, name).not.toMatch(/'krajozbior-testenv-/);
      expect(text, name).not.toMatch(/PreferredPort\s*=\s*\d/);
      expect(text, name).not.toMatch(/'\.data\/test-env\/test-env\.(json|env)'/);
    }
  });

  it("removes containers in down only through the station filter", () => {
    const down = script("test-env-down.ps1");

    expect(down).toContain("Select-OwnContainers");
    expect(down).not.toMatch(/docker[^\n]*(prune|--filter)/);
  });

  it("limits container memory, locks machine-wide and cleans up after a failed boot", () => {
    const up = script("test-env-up.ps1");

    expect(up).toContain("$PgMemory         = '1g'");
    expect(up).toContain('"--memory=$PgMemory"');
    expect(up).toContain("Enter-MachineLock $BootLockName");
    expect(up).toMatch(
      /\} catch \{\s*# A failed boot[\s\S]*?\$DownScript[\s\S]*?throw \$bootError\s*\} finally \{\s*Exit-MachineLock \$bootLock/,
    );
    expect(script("test-env-test.ps1")).toContain("Enter-MachineLock $E2eLockName");
    expect(script("test-env-lib.ps1")).toContain('"Global\\$name"');
  });
});
