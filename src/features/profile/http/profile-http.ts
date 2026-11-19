import "server-only";

import { isSameOrigin } from "@/features/identity/domain/origin";
import { getIdentityProvider } from "@/features/identity/infrastructure";
import {
  privateJson as json,
  readBoundedText,
  readJsonBody,
} from "@/features/visits/http/request-body";
import { logFailure } from "@/lib/log-failure";

import { saveMyProfile } from "../application/profile";
import type { ProfileDeps } from "../application/profile-types";
import { PROFILE_BODY_MAX_BYTES } from "../domain/limits";
import { getProfileDeps } from "../infrastructure/profile-deps";

// PUT (JSON) and POST (a native form of the settings screen) /api/me/profile:
// origin check, the actor from the session, a bounded body and the mapping of
// the use case answer to a status. A form post gets a redirect back to the
// settings screen instead of JSON, so the screen works without JavaScript.
// Rules live in the use case; the body never names an owner.

const SCREEN = "/my/settings";

function redirect(query: string): Response {
  const headers = new Headers({ "Cache-Control": "private, no-store" });

  headers.set("Location", `${SCREEN}?${query}#profil`);

  return new Response(null, { status: 303, headers });
}

async function readBody(
  request: Request,
  isForm: boolean,
): Promise<{ tooLarge: true } | { body: unknown }> {
  if (isForm) {
    // The native form of the settings screen is urlencoded; any other encoding
    // yields fields that do not exist, which the use case refuses as a bad request.
    const read = await readBoundedText(request, PROFILE_BODY_MAX_BYTES);

    return "tooLarge" in read
      ? read
      : { body: Object.fromEntries(new URLSearchParams(read.text).entries()) as unknown };
  }

  return readJsonBody(request, PROFILE_BODY_MAX_BYTES);
}

export async function handleProfileSave(
  request: Request,
  deps: ProfileDeps = getProfileDeps(),
): Promise<Response> {
  if (!isSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return json(403, { error: "forbidden_origin" });
  }

  const isForm = (request.headers.get("content-type") ?? "").includes("form");

  try {
    const actor = await getIdentityProvider().getActor(request.headers);

    // A guest is turned away before the body is read at all.
    if (actor === null) {
      return json(401, { error: "unauthenticated" });
    }

    const read = await readBody(request, isForm);

    if ("tooLarge" in read) {
      return isForm ? redirect("profil=blad") : json(413, { error: "payload_too_large" });
    }

    const outcome = await saveMyProfile(actor, read.body, deps);

    switch (outcome.status) {
      case "ok":
        return isForm ? redirect("profil=zapisano") : json(200, outcome.value);
      case "unauthenticated":
        return json(401, { error: "unauthenticated" });
      case "invalid":
        return isForm
          ? redirect(
              outcome.fields.length === 0
                ? "profil=blad"
                : `profil=blad&pola=${outcome.fields.join(",")}`,
            )
          : json(400, { error: "invalid", fields: outcome.fields });
      case "rate_limited":
        return isForm
          ? redirect("profil=limit")
          : json(
              429,
              { error: "rate_limited", message: "Za dużo zapisów, spróbuj za chwilę." },
              { "Retry-After": String(outcome.retryAfterSeconds) },
            );
    }
  } catch (error) {
    logFailure("Profile save", error);

    return isForm ? redirect("profil=niedostepny") : json(503, { error: "unavailable" });
  }
}
