import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  runNewsImport as runCommand,
  type NewsImportDeps,
  type NewsImportRunner,
  type NewsImportRunOutcome,
} from "@/features/news/application/news-import-command";

// `scripts/news-import.ts` reads `--confirm-host` itself and hands it to the command.
const runNewsImport = (argv: readonly string[], deps: NewsImportDeps) =>
  runCommand(argv, {
    confirmedHost: argv[argv.indexOf("--confirm-host") + 1],
    ...deps,
  });

const ID_1 = "3f6b1f4e-7a40-4d3b-9c55-0a1e2b3c4d51";
const ID_2 = "3f6b1f4e-7a40-4d3b-9c55-0a1e2b3c4d52";
const entry = (id: string, title: string, status = "published") =>
  JSON.stringify({ id, kind: "guide", title, lead: "Krótki opis.", body: "", status });
const file = `${entry(ID_1, "Zażółć gęślą jaźń")}\n${entry(ID_2, "Druga aktualność")}\n`;

const LOCAL_DB = "postgres://krajozbior_ops:x@localhost:5432/db";
const REMOTE_DB = "postgres://krajozbior_ops:x@db.example.com:5432/db";

function setup(outcome?: NewsImportRunOutcome, env: Partial<NewsImportDeps["env"]> = {}) {
  const run = vi.fn(async () => outcome as NewsImportRunOutcome);
  const close = vi.fn(async () => undefined);
  const connect = vi.fn(async (): Promise<NewsImportRunner> => ({ run, close }));
  const deps: NewsImportDeps = {
    readFile: async () => file,
    connect,
    env: { NODE_ENV: "development", DATABASE_OPS_URL: LOCAL_DB, host: "krajozbior.pl", ...env },
    defaultOperator: "marek",
  };

  return { run, close, connect, deps };
}

const done = (...states: ("created" | "updated" | "unchanged" | "withdrawn")[]) =>
  ({ kind: "done", states }) as const;
const json = (stdout: readonly string[]) => JSON.parse(stdout.at(-1)!);
const server = ["--target", "server", "--confirm-host", "krajozbior.pl"];

describe("news:import validation without a database", () => {
  it("checks the file alone when no database is configured and says it was not compared", async () => {
    const { connect, deps } = setup(undefined, { DATABASE_OPS_URL: undefined });
    const result = await runNewsImport(["--dry-run", "--file", "x"], deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout[0]).toBe("sprawdzona (bez porównania z bazą) | Zażółć gęślą jaźń");
    expect(json(result.stdout)).toEqual({ outcome: "preview", lines: 2, compared: false });
    expect(connect).not.toHaveBeenCalled();
  });

  it("answers an error of the file with exit 2 and the JSON line, before any connection", async () => {
    const { connect, deps } = setup();
    const result = await runNewsImport(["--dry-run", "--file", "x"], {
      ...deps,
      readFile: async () => `${entry(ID_1, "ab")}\n{zle`,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout[0]!.startsWith('{"outcome"')).toBe(true);
    expect(json(result.stdout)).toMatchObject({ outcome: "invalid", errorCount: 2 });
    expect(result.stderr[0]).toMatch(/^Linia 1:/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("lists at most 100 errors but counts all of them", async () => {
    const { deps } = setup();
    const result = await runNewsImport(["--dry-run", "--file", "x"], {
      ...deps,
      readFile: async () => Array.from({ length: 150 }, () => "{zle").join("\n"),
    });

    expect(json(result.stdout).errorCount).toBe(150);
    expect(json(result.stdout).errors).toHaveLength(100);
  });

  it("answers an unreadable file with exit 1 and no JSON", async () => {
    const { deps } = setup();
    const result = await runNewsImport(["--dry-run", "--file", "x"], {
      ...deps,
      readFile: async () => {
        throw new Error("ENOENT");
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
  });
});

describe("news:import arguments", () => {
  it.each([
    [["--dry-run"], "bez pliku"],
    [["--file", "x", "--nieznana"], "nieznana flaga"],
    [["--file", "x", "--target", "local"], "zły cel"],
    [["--file", "x", "--dry-run", "--confirm-host", "krajozbior.pl"], "host bez trybu serwera"],
    [["--file", "x", "--reason", "powód z adresem a@b.pl", "--operator", "x"], "e-mail w powodzie"],
    [["--file", "x", "--org-slug", "Zly Slug"], "zły slug organizacji"],
  ])("%j gives exit 1 without the JSON line: %s", async (argv) => {
    const { connect, deps } = setup(done("created", "created"));
    const result = await runNewsImport(argv as string[], deps);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr[0]).toMatch(/^Błąd wejścia/);
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires the operator and the reason for a write on the server", async () => {
    const { connect, deps } = setup();
    const result = await runNewsImport(["--file", "x", ...server], deps);

    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toContain("--operator");
    expect(connect).not.toHaveBeenCalled();
  });

  it("requires a database for a write", async () => {
    const { deps } = setup(undefined, { DATABASE_OPS_URL: undefined });
    const result = await runNewsImport(["--file", "x"], deps);

    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toContain("DATABASE_OPS_URL");
  });
});

describe("news:import guards", () => {
  it("refuses production and a database outside localhost without --target server (exit 3 with the JSON line)", async () => {
    for (const [env, code] of [
      [{ NODE_ENV: "production" }, "production"],
      [{ DATABASE_OPS_URL: REMOTE_DB }, "non_local_database"],
    ] as const) {
      const { connect, deps } = setup(undefined, env);
      const result = await runNewsImport(["--dry-run", "--file", "x"], deps);

      expect(result.exitCode).toBe(3);
      expect(json(result.stdout)).toEqual({ outcome: "refused", code });
      expect(connect).not.toHaveBeenCalled();
    }
  });

  it("accepts --operator and --reason without --target server (the showcase passes them)", async () => {
    const { run, deps } = setup(done("created", "updated"));
    const result = await runNewsImport(
      [
        "--file",
        "x",
        "--operator",
        "wlasciciel",
        "--reason",
        "Publikacja aktualnosci z pliku a.ndjson",
      ],
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(json(result.stdout)).toMatchObject({ outcome: "applied" });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        preview: false,
        operator: "wlasciciel",
        reason: "Publikacja aktualnosci z pliku a.ndjson",
        orgSlug: "krajozbior-redakcja",
      }),
    );
  });

  it("falls back to the user name for a local write without the flags", async () => {
    const { run, deps } = setup(done("created", "created"));

    await runNewsImport(["--file", "x"], deps);

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ operator: "marek" }));
  });

  it("refuses an organization outside the editorial list", async () => {
    const { connect, deps } = setup();
    const result = await runNewsImport(["--dry-run", "--file", "x", "--org-slug", "gmina-a"], deps);

    expect(result.exitCode).toBe(3);
    expect(json(result.stdout)).toEqual({
      outcome: "refused",
      code: "organization_not_allowed",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("on the server needs the confirmed host, and runs in production", async () => {
    const wrong = await runNewsImport(
      ["--dry-run", "--file", "x", "--target", "server", "--confirm-host", "inny.pl"],
      setup(undefined, { NODE_ENV: "production" }).deps,
    );
    const unset = await runNewsImport(
      ["--dry-run", "--file", "x", ...server],
      setup(undefined, { host: undefined }).deps,
    );
    const ok = setup(done("created", "created"), {
      NODE_ENV: "production",
      DATABASE_OPS_URL: REMOTE_DB,
    });
    const result = await runNewsImport(
      [
        "--dry-run",
        "--file",
        "x",
        ...server.map((s) => (s === "krajozbior.pl" ? "KRAJOZBIOR.pl" : s)),
      ],
      ok.deps,
    );

    expect(json(wrong.stdout)).toEqual({ outcome: "refused", code: "host_mismatch" });
    expect(json(unset.stdout)).toEqual({ outcome: "refused", code: "host_not_configured" });
    expect(wrong.exitCode).toBe(3);
    expect(result.exitCode).toBe(0);
    expect(ok.connect).toHaveBeenCalledOnce();
  });
});

describe("scripts/news-import.ts", () => {
  it("parses --confirm-host in its own code (the deployment mode looks for it there)", () => {
    const code = readFileSync("scripts/news-import.ts", "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

    expect(code).toContain('"confirm-host"');
    expect(code).toContain("confirmedHost");
  });
});

describe("news:import result", () => {
  it("prints the state and the title of each item, then the preview line with the states", async () => {
    const { run, close, deps } = setup(done("created", "withdrawn"));
    const result = await runNewsImport(["--dry-run", "--file", "x"], deps);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual([
      "nowa | Zażółć gęślą jaźń",
      "wycofana | Druga aktualność",
      '{"outcome":"preview","lines":2,"states":{"created":1,"updated":0,"unchanged":0,"withdrawn":1}}',
    ]);
    expect(result.stdout.slice(0, 2).every((l) => !l.startsWith('{"outcome"'))).toBe(true);
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ preview: true }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports an unchanged re-run with exit 0", async () => {
    const { deps } = setup(done("unchanged", "unchanged"));
    const result = await runNewsImport(["--file", "x"], deps);

    expect(result.exitCode).toBe(0);
    expect(json(result.stdout)).toEqual({
      outcome: "applied",
      lines: 2,
      results: { created: 0, updated: 0, unchanged: 2, withdrawn: 0 },
    });
  });

  it.each(["invalid_transition", "stale_link", "too_many_news", "slug_taken"] as const)(
    "turns the refusal %s into exit 3, the JSON line and the line of the file",
    async (code) => {
      const { close, deps } = setup({ kind: "rejected", code, line: 2 });
      const result = await runNewsImport(["--file", "x"], deps);

      expect(result.exitCode).toBe(3);
      expect(json(result.stdout)).toEqual({ outcome: "rejected", code, line: 2 });
      expect(result.stderr[0]).toContain("Linia 2");
      expect(result.stderr[0]).toContain(ID_2);
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it("turns a missing organization into a refusal", async () => {
    const { deps } = setup({ kind: "refused", code: "organization_not_found" });
    const result = await runNewsImport(["--file", "x"], deps);

    expect(result.exitCode).toBe(3);
    expect(json(result.stdout)).toEqual({ outcome: "refused", code: "organization_not_found" });
  });

  it("answers a failure with exit 1, the SQLSTATE class only and no JSON", async () => {
    const { deps, close } = setup();
    const result = await runNewsImport(["--file", "x"], {
      ...deps,
      connect: async () => ({
        run: async () => {
          throw Object.assign(new Error('password "tajne" failed'), { code: "28P01" });
        },
        close,
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.join("\n")).toContain("klasa 28");
    expect(result.stderr.join("\n")).not.toContain("tajne");
    expect(close).toHaveBeenCalledOnce();
  });

  it("shows a configuration error as it is", async () => {
    const { deps } = setup();
    const result = await runNewsImport(["--file", "x"], {
      ...deps,
      connect: async () => {
        throw Object.assign(new Error("Brakuje DATABASE_OPS_URL"), { name: "ServerConfigError" });
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toEqual(["Brakuje DATABASE_OPS_URL"]);
  });
});
