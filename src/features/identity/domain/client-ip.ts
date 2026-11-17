import { isIP } from "node:net";

// Headers a trusted proxy may set with the client's address (issue #39). Route
// handlers never see the socket address, so the client IP is only as reliable
// as the proxy that writes this header; AUTH_CLIENT_IP_HEADER names it.
export type ClientIpHeader = "x-real-ip" | "cf-connecting-ip" | "x-forwarded-for";

const hexGroups = (part: string) =>
  part === "" ? [] : part.split(":").map((g) => parseInt(g, 16));

// Expands a valid IPv6 address (checked by isIP) into its eight 16-bit groups.
function ipv6Groups(address: string): number[] {
  let text = address;
  const tail: number[] = [];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);

  // An embedded IPv4 tail (::ffff:192.0.2.1) fills the last two groups.
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, dotted.index);

    if (!text.endsWith("::")) {
      text = text.slice(0, -1);
    }
  }

  const [head, rest] = text.split("::");
  const left = hexGroups(head);
  const right = rest === undefined ? [] : hexGroups(rest);
  const zeros = new Array<number>(Math.max(8 - tail.length - left.length - right.length, 0));

  return [...left, ...zeros.fill(0), ...right, ...tail];
}

// Normalizes an address to the unit the limiter counts: an IPv4 address as is,
// an IPv6 address as its /64 prefix (a client can freely rotate addresses
// inside one /64). IPv4-mapped IPv6 addresses count as their IPv4 address.
export function throttleAddress(address: string): string | null {
  const value = address.trim();
  const version = isIP(value);

  if (version === 4) {
    return value;
  }

  if (version !== 6) {
    return null;
  }

  const groups = ipv6Groups(value.toLowerCase());

  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }

  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")}::/64`;
}

// The client address from the configured header, or null when no header is
// configured or its value is not an address. For X-Forwarded-For only the last
// entry counts: it is the one the trusted proxy appended, while entries to its
// left come from the client and can be forged.
export function clientIp(headers: Headers, header: ClientIpHeader | undefined): string | null {
  if (header === undefined) {
    return null;
  }

  const value = headers.get(header);

  if (value === null) {
    return null;
  }

  const entry = header === "x-forwarded-for" ? value.slice(value.lastIndexOf(",") + 1) : value;

  return throttleAddress(entry);
}
