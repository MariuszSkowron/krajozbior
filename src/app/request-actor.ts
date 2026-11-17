import { headers } from "next/headers";
import { cache } from "react";

import { getIdentityProvider } from "@/features/identity/infrastructure";

// One session lookup per request, shared by layouts and pages. Authorization
// itself lives in the use cases, never in what a page chooses to render.
export const getRequestActor = cache(async () => getIdentityProvider().getActor(await headers()));

/** Logs only the error class of a failed session lookup: never its message, stack or session data. */
export function logActorFailure(error: unknown): void {
  console.error("Session lookup failed:", error instanceof Error ? error.name : "unknown error");
}

/** Logs only what failed and the error class of an unexpected throw: never its message, stack, slug or user. */
export function logReadFailure(what: string, error: unknown): void {
  console.error(`${what} failed:`, error instanceof Error ? error.name : "unknown error");
}

/** `/login` that returns to `path` (a same-site path) after signing in. */
export function loginHref(path: string): string {
  return `/login?returnTo=${encodeURIComponent(path)}`;
}
