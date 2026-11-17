import { describe, expect, it } from "vitest";

import { emailLimitKey } from "@/features/identity/domain/email-limit-key";

describe("emailLimitKey: one key per mailbox, aliases folded", () => {
  it("lower-cases and trims", () => {
    expect(emailLimitKey("  Jan@Example.COM ")).toBe("jan@example.com");
  });

  it("drops a +tag for every domain", () => {
    expect(emailLimitKey("jan+1@example.com")).toBe("jan@example.com");
    expect(emailLimitKey("jan+a+b@onet.pl")).toBe("jan@onet.pl");
  });

  it("keeps the dots outside Gmail", () => {
    expect(emailLimitKey("j.an@example.com")).toBe("j.an@example.com");
  });

  it("drops dots and +tags for gmail.com and googlemail.com and joins the two domains", () => {
    expect(emailLimitKey("j.an@gmail.com")).toBe("jan@gmail.com");
    expect(emailLimitKey("J.A.N+promo@GoogleMail.com")).toBe("jan@gmail.com");
    expect(emailLimitKey("jan+1@gmail.com")).toBe(emailLimitKey("j.an@gmail.com"));
  });

  it("keeps a local part that starts with + or is only dots", () => {
    expect(emailLimitKey("+tag@example.com")).toBe("+tag@example.com");
    expect(emailLimitKey("..@gmail.com")).toBe("..@gmail.com");
  });

  it("returns text without a usable @ unchanged apart from case", () => {
    expect(emailLimitKey("Brak-Malpy")).toBe("brak-malpy");
    expect(emailLimitKey("@example.com")).toBe("@example.com");
  });
});
