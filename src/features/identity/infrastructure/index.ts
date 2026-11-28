import "server-only";

import { getAuthEnv } from "@/lib/config/env";

import type { ActionRateLimiter } from "../domain/action-rate-limit";
import type { ClientIpHeader } from "../domain/client-ip";
import type { IdentityProvider } from "../domain/identity-provider";
import {
  DEFAULT_OTP_GLOBAL_DAILY_LIMIT,
  DEFAULT_OTP_NEW_ACCOUNT_DAILY_LIMIT,
  type OtpSendLimiter,
} from "../domain/otp-send-limits";
import type { SignInThrottle } from "../domain/sign-in-throttle";
import { BetterAuthIdentityProvider, getAuthPool } from "./better-auth";
import { logFailure } from "@/lib/log-failure";

import { deleteAccountRows } from "./delete-account-rows";
import { deleteAbandonedAccounts } from "./postgres-abandoned-accounts-cleanup";
import { PostgresActionRateLimiter } from "./postgres-action-rate-limiter";
import { deleteExpiredSessions } from "./postgres-expired-sessions-cleanup";
import { otpSendHmacKey, PostgresOtpSendLimiter } from "./postgres-otp-send-limiter";
import {
  CODE_VERIFY_PREFIX,
  PostgresSignInThrottle,
  throttleHmacKey,
} from "./postgres-sign-in-throttle";

let provider: IdentityProvider | undefined;

export function getIdentityProvider(): IdentityProvider {
  provider ??= new BetterAuthIdentityProvider();

  return provider;
}

let throttle: SignInThrottle | undefined;

// Password sign-in attempts.
export function getSignInThrottle(): SignInThrottle {
  throttle ??= new PostgresSignInThrottle(
    getAuthPool,
    throttleHmacKey(getAuthEnv().BETTER_AUTH_SECRET),
  );

  return throttle;
}

let codeVerifyThrottle: SignInThrottle | undefined;

// Sign-in code checks: the same limits, counted apart from password sign-in.
export function getCodeVerifyThrottle(): SignInThrottle {
  codeVerifyThrottle ??= new PostgresSignInThrottle(
    getAuthPool,
    throttleHmacKey(getAuthEnv().BETTER_AUTH_SECRET),
    CODE_VERIFY_PREFIX,
  );

  return codeVerifyThrottle;
}

let otpSendLimiter: OtpSendLimiter | undefined;

// Sign-in code requests: per-address, per-IP and global daily limits.
export function getOtpSendLimiter(): OtpSendLimiter {
  otpSendLimiter ??= new PostgresOtpSendLimiter(
    getAuthPool,
    otpSendHmacKey(getAuthEnv().BETTER_AUTH_SECRET),
    () => getAuthEnv().OTP_GLOBAL_DAILY_LIMIT ?? DEFAULT_OTP_GLOBAL_DAILY_LIMIT,
    () => getAuthEnv().OTP_NEW_ACCOUNT_DAILY_LIMIT ?? DEFAULT_OTP_NEW_ACCOUNT_DAILY_LIMIT,
  );

  return otpSendLimiter;
}

/**
 * Removes a batch of expired sessions (retention in the privacy policy). Never
 * throws: a failed cleanup is logged by class only and must not block sign-in.
 */
export async function cleanupExpiredSessions(): Promise<void> {
  try {
    await deleteExpiredSessions(await getAuthPool());
  } catch (error) {
    logFailure("Expired sessions cleanup", error);
  }
}

// At most one pass per process and hour: the pass looks at accounts, not at one request.
const ABANDONED_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastAbandonedCleanup = 0;

/**
 * Deletes accounts that never accepted the terms and are older than 7 days (privacy policy 1.1,
 * section 9). Runs at most once an hour per process, never throws: a failed pass is logged by
 * class only and must not block sign-in. The operator can run the same pass with
 * `npm run auth:cleanup-abandoned`.
 */
export async function cleanupAbandonedAccounts(now: number = Date.now()): Promise<void> {
  if (now - lastAbandonedCleanup < ABANDONED_CLEANUP_INTERVAL_MS) {
    return;
  }

  lastAbandonedCleanup = now;

  try {
    await deleteAbandonedAccounts(await getAuthPool());
  } catch (error) {
    logFailure("Abandoned accounts cleanup", error);
  }
}

/**
 * The person declined the terms: deletes the account at once, but only when it never accepted any
 * version, has the plain role and no organization (the database checks it too). Returns false when
 * the account stayed.
 */
export async function deleteNeverAcceptedAccount(accountId: string): Promise<boolean> {
  return deleteAccountRows(await getAuthPool(), accountId, { onlyAbandonedOlderThanDays: 0 });
}

let actionRateLimiter: ActionRateLimiter | undefined;

export function getActionRateLimiter(): ActionRateLimiter {
  actionRateLimiter ??= new PostgresActionRateLimiter(getAuthPool);

  return actionRateLimiter;
}

// The configured client-address header, read per request so tests can change it.
export function getClientIpHeader(): ClientIpHeader | undefined {
  return getAuthEnv().AUTH_CLIENT_IP_HEADER;
}
