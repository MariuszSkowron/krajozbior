import { computeProgress } from "@/features/album/domain/progress";
import { isUuid } from "@/features/catalog/domain/uuid";
import {
  AuthenticationRequiredError,
  requireActor,
  type Actor,
} from "@/features/identity/domain/actor";

import { VISIT_ACTION, visitLimit } from "../domain/limits";
import { toVisitOutcome } from "../domain/visit-outcome";
import { parseVisitRequest } from "../domain/visit-request";
import type { VisitDeps, VisitResponse, VisitUseCaseOutcome } from "./visit-types";

// Confirming a visit on site (E2-S2, PR7). The actor is the session, never a
// parameter; the owner of the visit is app_current_user_id() in the database.
// The rule (distance against the radius of the place, accuracy up to 150 m) is
// in record_on_site_visit() only; this use case adds the session, the abuse
// limit, the shape check and the progress shown afterwards (spec D-T3, D-T9).
// The position of the device is used for this one call: it is not stored, not
// logged and not returned. A curator has no path to the visits of anybody (R-09).

// 22023 (invalid_parameter_value): the function's answer for an id already used
// for another place, or for a value outside its own checks.
const INVALID_PARAMETER = "22023";

const isInvalidParameter = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === INVALID_PARAMETER;

export async function confirmOnSiteVisit(
  actor: Actor | null,
  placeId: string,
  body: unknown,
  deps: VisitDeps,
): Promise<VisitUseCaseOutcome<VisitResponse>> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  const decision = await deps.limiter.reserve(VISIT_ACTION, signedIn.id, visitLimit);

  if (!decision.allowed) {
    return { status: "rate_limited", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const request = parseVisitRequest(body);

  if (request === null) {
    return { status: "invalid" };
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  try {
    return await deps.withUserContext(signedIn, async (tx) => {
      const outcome = toVisitOutcome(
        await deps.repository.recordOnSiteVisit(tx, placeId, request),
        request.accuracyM,
      );

      switch (outcome.result) {
        case "not_found":
          return { status: "not_found" } as const;
        case "out_of_range":
          return {
            status: "ok",
            value: { result: "out_of_range", distanceM: outcome.distanceM },
          } as const;
        case "inaccurate":
          return {
            status: "ok",
            value: { result: "inaccurate", accuracyM: outcome.accuracyM },
          } as const;
        case "recorded": {
          const collections = await deps.album.listSavedCollections(tx);
          const links = await deps.album.listSavedCollectionPlaces(tx);
          const visited = await deps.album.listVisitedPlaceIds(tx);

          return {
            status: "ok",
            value: {
              result: "recorded",
              collections: collections
                .filter((collection) =>
                  links.some((l) => l.collectionId === collection.id && l.placeId === placeId),
                )
                .map((collection) => ({
                  slug: collection.slug,
                  title: collection.title,
                  progress: computeProgress(
                    links.filter((l) => l.collectionId === collection.id).map((l) => l.placeId),
                    visited,
                  ),
                })),
            },
          } as const;
        }
      }
    });
  } catch (error) {
    if (isInvalidParameter(error)) {
      return { status: "invalid" };
    }
    throw error;
  }
}

/** Whether the signed-in explorer already has a visit of the place (for the place page). */
export async function hasVisitedPlace(
  actor: Actor | null,
  placeId: string,
  deps: VisitDeps,
): Promise<VisitUseCaseOutcome<{ visited: boolean }>> {
  let signedIn: Actor;

  try {
    signedIn = requireActor(actor);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" };
    }
    throw error;
  }

  if (!isUuid(placeId)) {
    return { status: "not_found" };
  }

  return deps.withUserContext(signedIn, async (tx) => ({
    status: "ok",
    value: { visited: await deps.repository.hasVisitedPlace(tx, placeId) },
  }));
}
