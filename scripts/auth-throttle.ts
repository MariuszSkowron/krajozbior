// Operator procedure for the sign-in limiter (issue #39): block, unblock or
// inspect one account or one client address. Connects as starter_auth through
// DATABASE_AUTH_URL; prints no secrets and no stored key.
//
// Run with:
//   npm run auth:throttle -- block --email user@example.com --minutes 60
//   npm run auth:throttle -- block --ip 203.0.113.7
//   npm run auth:throttle -- unblock --email user@example.com
//   npm run auth:throttle -- status --ip 203.0.113.7
//   npm run auth:throttle -- unblock-otp --email user@example.com   (sign-in code requests)
import { parseArgs } from "node:util";

import { throttleAddress } from "../src/features/identity/domain/client-ip";
import { closeAuth, getAuthPool } from "../src/features/identity/infrastructure/better-auth";
import {
  otpSendHmacKey,
  unblockOtpSend,
} from "../src/features/identity/infrastructure/postgres-otp-send-limiter";
import {
  blockBucket,
  blockKey,
  bucketStatus,
  throttleHmacKey,
  unblockBucket,
  type BlockTarget,
} from "../src/features/identity/infrastructure/postgres-sign-in-throttle";
import { getAuthEnv } from "../src/lib/config/env";

const DEFAULT_BLOCK_MINUTES = 60;

function target(values: { email?: string; ip?: string }): BlockTarget {
  if ((values.email === undefined) === (values.ip === undefined)) {
    throw new Error("Pass exactly one of --email or --ip");
  }

  if (values.email !== undefined) {
    return { email: values.email };
  }

  const ip = throttleAddress(values.ip ?? "");

  if (ip === null) {
    throw new Error("--ip is not an IP address");
  }

  return { ip };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { email: { type: "string" }, ip: { type: "string" }, minutes: { type: "string" } },
  });
  const command = positionals[0];
  const minutes = Number(values.minutes ?? DEFAULT_BLOCK_MINUTES);

  if (!["block", "unblock", "status", "unblock-otp"].includes(command ?? "")) {
    throw new Error(
      "Usage: auth:throttle <block|unblock|status|unblock-otp> (--email <e-mail> | --ip <address>)",
    );
  }

  if (!Number.isInteger(minutes) || minutes < 1) {
    throw new Error("--minutes must be a positive whole number");
  }

  const subject = target(values);
  const label = "email" in subject ? "account" : `address ${subject.ip}`;
  const key = blockKey(subject, throttleHmacKey(getAuthEnv().BETTER_AUTH_SECRET));

  try {
    const pool = await getAuthPool();

    if (command === "unblock-otp") {
      const removed = await unblockOtpSend(
        pool,
        subject,
        otpSendHmacKey(getAuthEnv().BETTER_AUTH_SECRET),
      );
      console.log(`Sign-in code request counters cleared for ${label} (${removed} rows)`);
    } else if (command === "block") {
      const until = await blockBucket(pool, key, minutes);
      console.log(`Sign-in blocked for ${label} until ${until.toISOString()}`);
    } else if (command === "unblock") {
      await unblockBucket(pool, key);
      console.log(`Sign-in block and counters cleared for ${label}`);
    } else {
      const status = await bucketStatus(pool, key);
      console.log(
        status === null
          ? `No recent sign-in attempts for ${label}`
          : `${label}: ${status.attempts} attempts since ${status.windowStartedAt.toISOString()}, ` +
              `blocked until ${status.lockedUntil?.toISOString() ?? "not blocked"}`,
      );
    }
  } finally {
    await closeAuth();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
