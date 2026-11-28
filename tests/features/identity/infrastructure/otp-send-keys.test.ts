import { describe, expect, it } from "vitest";

import { throttleAddress } from "@/features/identity/domain/client-ip";
import {
  emailHash,
  otpSendHmacKey,
  otpSendKeys,
} from "@/features/identity/infrastructure/postgres-otp-send-limiter";
import {
  CODE_VERIFY_PREFIX,
  throttleHmacKey,
  throttleKeys,
} from "@/features/identity/infrastructure/postgres-sign-in-throttle";

const SECRET = "unit-test-secret-0123456789abcdef0123";
const email = "jan@example.com";
const key = otpSendHmacKey(SECRET);

describe("sign-in code request keys", () => {
  it("never puts the address or the IP into a key in clear text", () => {
    const keys = otpSendKeys({ email, ip: "203.0.113.7" }, key);

    for (const { key: name } of [...keys.window, ...keys.daily]) {
      expect(name).not.toContain("jan");
      expect(name).not.toContain("203.0.113.7");
    }
    expect(keys.daily.map(({ scope }) => scope).sort()).toEqual([
      "accounts",
      "email",
      "emailIp",
      "global",
      "ip",
      "newAccounts",
      "sentEmail",
    ]);
  });

  it("folds aliases of one mailbox into the same address buckets", () => {
    expect(emailHash("jan+promo@example.com", key)).toBe(emailHash(email, key));
    expect(emailHash("J.An+x@GoogleMail.com", key)).toBe(emailHash("jan@gmail.com", key));
  });

  it("has no IP bucket without a known client IP", () => {
    const keys = otpSendKeys({ email, ip: null }, key);

    expect(keys.window.map(({ scope }) => scope).sort()).toEqual(["email", "emailIp"]);
    expect(keys.window.find(({ scope }) => scope === "emailIp")?.key).toMatch(/:unknown$/);
  });

  it("counts two addresses of one IPv6 /64 as one IP", () => {
    const ipKeys = (ip: string) => otpSendKeys({ email, ip: throttleAddress(ip) }, key);

    expect(ipKeys("2001:db8:a:1::1")).toEqual(ipKeys("2001:db8:a:1::2"));
    expect(ipKeys("2001:db8:a:1::1")).not.toEqual(ipKeys("2001:db8:a:2::1"));
  });

  it("uses keys apart from the password sign-in buckets", () => {
    const passwordKeys = throttleKeys({ email, ip: "203.0.113.7" }, throttleHmacKey(SECRET));
    const otpKeys = otpSendKeys({ email, ip: "203.0.113.7" }, key).window;

    for (const { key: name } of otpKeys) {
      expect(name.startsWith("otp_send:")).toBe(true);
      expect(passwordKeys.map(({ key: k }) => k)).not.toContain(name);
    }
  });
});

describe("sign-in code check keys", () => {
  it("are the password keys under their own prefix, so they never share a counter", () => {
    const hmac = throttleHmacKey(SECRET);
    const subject = { email, ip: "203.0.113.7" };
    const password = throttleKeys(subject, hmac).map(({ key: k }) => k);
    const code = throttleKeys(subject, hmac, CODE_VERIFY_PREFIX).map(({ key: k }) => k);

    expect(code).toEqual(password.map((k) => `${CODE_VERIFY_PREFIX}${k}`));
    expect(code.some((k) => password.includes(k))).toBe(false);
  });
});
