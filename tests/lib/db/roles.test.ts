import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { provisionDatabaseRoles, readRolePasswords, scramSha256Verifier } from "@/lib/db/roles";

const validSource = {
  KRAJOZBIOR_OWNER_DB_PASSWORD: "owner-password-0123",
  KRAJOZBIOR_APP_DB_PASSWORD: "app-password-012345",
  KRAJOZBIOR_AUTH_DB_PASSWORD: "auth-password-01234",
  KRAJOZBIOR_OPS_DB_PASSWORD: "ops-password-012345",
};

function fakeClient(unsafeRoles: string[] = [], creatorRoles: string[] = []) {
  const queries: string[] = [];
  const client = {
    escapeLiteral: (value: string) => `'${value.replaceAll("'", "''")}'`,
    query: vi.fn(async (sql: string) => {
      queries.push(sql);
      const found = sql.includes("rolsuper")
        ? unsafeRoles
        : sql.includes("has_schema_privilege")
          ? creatorRoles
          : [];
      return { rows: found.map((rolname) => ({ rolname })) };
    }),
  };

  return { client, queries };
}

describe("readRolePasswords", () => {
  it("maps each role to its password variable", () => {
    expect(readRolePasswords(validSource)).toEqual({
      krajozbior_owner: "owner-password-0123",
      krajozbior_app: "app-password-012345",
      krajozbior_auth: "auth-password-01234",
      krajozbior_ops: "ops-password-012345",
    });
  });

  it("names missing and too short variables without their values", () => {
    const action = () =>
      readRolePasswords({
        ...validSource,
        KRAJOZBIOR_APP_DB_PASSWORD: "tiny-secret",
        KRAJOZBIOR_OPS_DB_PASSWORD: undefined,
      });

    expect(action).toThrow(
      "Missing or too short (min. 16 characters): KRAJOZBIOR_APP_DB_PASSWORD, KRAJOZBIOR_OPS_DB_PASSWORD",
    );
    expect(action).not.toThrow(/tiny-secret/);
  });

  it("names passwords outside printable ASCII without their values", () => {
    const action = () =>
      readRolePasswords({ ...validSource, KRAJOZBIOR_AUTH_DB_PASSWORD: "zażółć-gęślą-jaźń" });

    expect(action).toThrow(
      "Only printable ASCII characters are allowed: KRAJOZBIOR_AUTH_DB_PASSWORD",
    );
    expect(action).not.toThrow(/jaźń/);
  });
});

describe("scramSha256Verifier", () => {
  // RFC 7677, section 3: the exchange of user "user" with password "pencil".
  // The verifier must accept the client's proof and produce the server's
  // signature, the same checks PostgreSQL runs at login.
  const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
  const nonce = "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
  const authMessage = [
    "n=user,r=rOprNGfwEbeRWgbNEkqO",
    `r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`,
    `c=biws,r=${nonce}`,
  ].join(",");
  const clientProof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
  const serverSignature = "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=";

  it("produces the verifier PostgreSQL stores, matching the RFC 7677 exchange", () => {
    const verifier = scramSha256Verifier("pencil", salt);
    const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier);

    expect(match?.[1]).toBe(salt.toString("base64"));
    const storedKey = Buffer.from(match![2]!, "base64");
    const serverKey = Buffer.from(match![3]!, "base64");
    const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
    const clientKey = Buffer.from(clientProof.map((byte, index) => byte ^ clientSignature[index]!));

    expect(timingSafeEqual(createHash("sha256").update(clientKey).digest(), storedKey)).toBe(true);
    expect(createHmac("sha256", serverKey).update(authMessage).digest("base64")).toBe(
      serverSignature,
    );
  });

  it("uses a fresh salt for every call", () => {
    expect(scramSha256Verifier("pencil")).not.toBe(scramSha256Verifier("pencil"));
  });
});

describe("provisionDatabaseRoles", () => {
  it("creates every role without superuser rights and never sends a plain password", async () => {
    const { client, queries } = fakeClient();
    const passwords = readRolePasswords(validSource);

    await provisionDatabaseRoles(client as never, passwords);

    for (const role of [
      "krajozbior_owner",
      "krajozbior_app",
      "krajozbior_auth",
      "krajozbior_ops",
    ]) {
      expect(queries.some((sql) => sql.includes(`create role ${role};`))).toBe(true);
    }
    const alters = queries.filter((query) => query.startsWith("alter role"));

    expect(alters).toHaveLength(4);
    for (const sql of alters) {
      expect(sql).toMatch(
        /^alter role krajozbior_\w+ with login noinherit nocreaterole nocreatedb password 'SCRAM-SHA-256\$4096:[^']+'$/,
      );
    }
    for (const password of Object.values(passwords)) {
      expect(queries.some((sql) => sql.includes(password))).toBe(false);
    }
  });

  it("keeps role verifiers out of the server log by switching statement logging off first", async () => {
    const { client, queries } = fakeClient();

    await provisionDatabaseRoles(client as never, readRolePasswords(validSource));

    expect(queries[0]).toBe("set log_statement = 'none'");
  });

  it("revokes CREATE on the public schema from PUBLIC and the runtime roles before granting it to the owner", async () => {
    const { client, queries } = fakeClient();

    await provisionDatabaseRoles(client as never, readRolePasswords(validSource));

    const revoke = queries.indexOf(
      "revoke create on schema public from public, krajozbior_app, krajozbior_auth, krajozbior_ops",
    );

    expect(revoke).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(
      queries.indexOf("grant usage, create on schema public to krajozbior_owner"),
    );
  });

  it("refuses roles that were given superuser or BYPASSRLS by hand", async () => {
    const { client } = fakeClient(["krajozbior_app"]);

    await expect(
      provisionDatabaseRoles(client as never, readRolePasswords(validSource)),
    ).rejects.toThrow("Roles must not be superuser, bypass RLS or replicate: krajozbior_app");
  });

  it("refuses runtime roles that can still create objects in the public schema", async () => {
    const { client } = fakeClient([], ["krajozbior_ops"]);

    await expect(
      provisionDatabaseRoles(client as never, readRolePasswords(validSource)),
    ).rejects.toThrow("Roles must not create objects in the public schema: krajozbior_ops");
  });
});
