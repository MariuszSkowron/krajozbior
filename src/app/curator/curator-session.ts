import { notFound, redirect } from "next/navigation";

import { formatSavedDate } from "@/features/want-to-see/domain/saved-date";

import { getRequestActor, loginHref } from "@/app/request-actor";
import { getApprovedOrganizations } from "@/app/request-organizations";
import type { CuratorOutcome } from "@/features/catalog/application/catalog-types";
import type { Actor } from "@/features/identity/domain/actor";
import type { MyOrganization } from "@/features/organizations/application/list-my-organizations";

// Entry of every curator page. A guest goes to /login and returns here. An
// account without an approved organization gets the ordinary "Nie znaleziono"
// (the panel does not announce itself). This is only the choice of a screen:
// every read and write below it is checked again by the use case and the
// database (docs/data-isolation.md).
export async function requireCurator(
  returnPath: string,
): Promise<{ actor: Actor; organizations: readonly [MyOrganization, ...MyOrganization[]] }> {
  const actor = await getRequestActor();

  if (actor === null) {
    redirect(loginHref(returnPath));
  }

  const [first, ...rest] = await getApprovedOrganizations();

  if (first === undefined) {
    notFound();
  }

  return { actor, organizations: [first, ...rest] };
}

// The answer of a read use case as a page needs it: the value, or the same
// "Nie znaleziono" for a missing and for a foreign resource.
export function pageValue<T>(outcome: CuratorOutcome<T>, returnPath: string): T {
  switch (outcome.status) {
    case "ok":
      return outcome.value;
    case "unauthenticated":
      return redirect(loginHref(returnPath));
    case "forbidden":
    case "not_found":
      return notFound();
    default:
      throw new Error(`Unexpected answer of a curator read: ${outcome.status}`);
  }
}

/** `dd.mm` in Polish time, with the year when it is not the current one (a list of dates). */
export function formatDate(date: Date): string {
  return formatSavedDate(date);
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
