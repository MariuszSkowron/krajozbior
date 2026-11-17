import { describe, expect, it } from "vitest";

import { clientIp, throttleAddress } from "@/features/identity/domain/client-ip";

describe("throttleAddress", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"],
    ["2001:DB8:1:2::9", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["::ffff:198.51.100.4", "198.51.100.4"],
    ["::ffff:c633:6404", "198.51.100.4"],
    ["::192.0.2.1", "0:0:0:0::/64"],
    ["2001:db8:1:2:3:4:192.0.2.1", "2001:db8:1:2::/64"],
  ])("normalizes %s to %s", (address, expected) => {
    expect(throttleAddress(address)).toBe(expected);
  });

  it("puts addresses from one /64 into one bucket", () => {
    expect(throttleAddress("2001:db8:a:b:1::1")).toBe(throttleAddress("2001:db8:a:b:ffff::2"));
  });

  it.each(["", "unknown", "203.0.113", "300.1.1.1", "2001:db8::g", "203.0.113.7:443"])(
    "rejects %j",
    (address) => {
      expect(throttleAddress(address)).toBeNull();
    },
  );
});

describe("clientIp", () => {
  const headers = (init: Record<string, string>) => new Headers(init);

  it("ignores every header when none is configured", () => {
    expect(clientIp(headers({ "x-real-ip": "203.0.113.7" }), undefined)).toBeNull();
  });

  it("reads only the configured header", () => {
    const request = headers({ "x-real-ip": "203.0.113.7", "cf-connecting-ip": "198.51.100.1" });

    expect(clientIp(request, "cf-connecting-ip")).toBe("198.51.100.1");
  });

  it("takes the last X-Forwarded-For entry, the one the proxy appended", () => {
    const request = headers({ "x-forwarded-for": "10.0.0.1, 192.0.2.9,203.0.113.7" });

    expect(clientIp(request, "x-forwarded-for")).toBe("203.0.113.7");
  });

  it("returns null when the configured header is missing or not an address", () => {
    expect(clientIp(headers({}), "x-real-ip")).toBeNull();
    expect(clientIp(headers({ "x-real-ip": "localhost" }), "x-real-ip")).toBeNull();
  });
});
