import "server-only";

import { getAuthEnv } from "@/lib/config/env";

import type { ActionRateLimiter } from "../domain/action-rate-limit";
import type { ClientIpHeader } from "../domain/client-ip";
import type { IdentityProvider } from "../domain/identity-provider";
import { DEFAULT_OTP_GLOBAL_DAILY_LIMIT, type OtpSendLimiter } from "../domain/otp-send-limits";
import type { SignInThrottle } from "../domain/sign-in-throttle";
import { BetterAuthIdentityProvider, getAuthPool } from "./better-auth";
import { PostgresActionRateLimiter } from "./postgres-action-rate-limiter";
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
  );

  return otpSendLimiter;
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
