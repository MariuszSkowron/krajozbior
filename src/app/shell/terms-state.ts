import { unstable_rethrow } from "next/navigation";

import { getRequestActor } from "@/app/request-actor";
import { hasAcceptedCurrentTerms } from "@/features/terms/application/terms";
import { getTermsDeps } from "@/features/terms/infrastructure/terms-deps";
import { logFailure } from "@/lib/log-failure";

/**
 * Whether the shell may show the page to this request: a guest always may; a signed-in account
 * only after accepting the current terms (F-K3, E11-Q4 A). A failed lookup counts as "not
 * accepted" and is logged: the gate fails closed, and it says nothing technical to the person.
 */
export async function shellTermsAccepted(): Promise<boolean> {
  try {
    const actor = await getRequestActor();

    if (actor === null) {
      return true;
    }

    const outcome = await hasAcceptedCurrentTerms(actor, getTermsDeps());

    return outcome.status === "ok" && outcome.value;
  } catch (error) {
    // Next.js signals request-time rendering by throwing; that is not a lookup failure.
    unstable_rethrow(error);
    logFailure("Terms acceptance lookup", error);

    return false;
  }
}
