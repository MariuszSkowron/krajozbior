import { unstable_rethrow } from "next/navigation";

import { getRequestActor, logActorFailure } from "@/app/request-actor";
import type { Role } from "@/features/identity/domain/actor";

/**
 * Role the shell is drawn for. A failed session lookup draws the guest shell
 * and is logged; the page still renders and private pages authorize in their
 * use cases as before (E06-S01). The shell only chooses links, never access.
 */
export async function shellRole(): Promise<Role | null> {
  try {
    return (await getRequestActor())?.role ?? null;
  } catch (error) {
    // Next.js signals request-time rendering of `headers()` by throwing; that
    // is not a session failure and must reach Next.js.
    unstable_rethrow(error);
    logActorFailure(error);
    return null;
  }
}
