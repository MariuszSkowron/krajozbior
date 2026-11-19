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
import {
  PROFILE_DRAFT_MAX_AGE_SECONDS,
  clearedProfileDraftCookie,
  profileDraftCookie,
  serializeProfileDraft,
} from "../domain/profile-draft";
import { getProfileDeps } from "../infrastructure/profile-deps";

// PUT (JSON) and POST (a native form of the settings screen) /api/me/profile:
// origin check, the actor from the session, a bounded body and the mapping of
// the use case answer to a status. A form post gets a redirect back to the
// settings screen instead of JSON, so the screen works without JavaScript.
// Rules live in the use case; the body never names an owner.

const SCREEN = "/my/settings";

// `target` is the fragment: an error goes to the summary of errors (it takes focus,
// also without JavaScript), a success to the section. `draft` carries the typed
// values of a refused post in a cookie (never in the URL); every redirect clears it
// unless it carries a new one.
function redirect(query: string, target: string, draft?: string | null): Response {
  const headers = new Headers({ "Cache-Control": "private, no-store" });

  headers.set("Location", `${SCREEN}?${query}#${target}`);
  headers.append(
    "Set-Cookie",
    draft ? profileDraftCookie(draft, PROFILE_DRAFT_MAX_AGE_SECONDS) : clearedProfileDraftCookie(),
  );

  return new Response(null, { status: 303, headers });
}

// A form post of a guest (the session expired while the form was open) goes to the
// sign-in and back; a JSON caller gets 401.
function unauthenticated(isForm: boolean): Response {
  if (!isForm) {
    return json(401, { error: "unauthenticated" });
  }

  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Location: `/login?returnTo=${encodeURIComponent(SCREEN)}`,
  });

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

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isForm =
    contentType.startsWith("application/x-www-form-urlencoded") ||
    contentType.startsWith("multipart/form-data");

  try {
    const actor = await getIdentityProvider().getActor(request.headers);

    // A guest is turned away before the body is read at all.
    if (actor === null) {
      return unauthenticated(isForm);
    }

    const read = await readBody(request, isForm);

    if ("tooLarge" in read) {
      return isForm
        ? redirect("profil=blad", "profile-error")
        : json(413, { error: "payload_too_large" });
    }

    const outcome = await saveMyProfile(actor, read.body, deps);

    switch (outcome.status) {
      case "ok":
        return isForm ? redirect("profil=zapisano", "profil") : json(200, outcome.value);
      case "unauthenticated":
        return unauthenticated(isForm);
      case "invalid":
        return isForm
          ? redirect(
              outcome.fields.length === 0
                ? "profil=blad"
                : `profil=blad&pola=${outcome.fields.join(",")}`,
              "profile-error",
              serializeProfileDraft(read.body),
            )
          : json(400, { error: "invalid", fields: outcome.fields });
      case "rate_limited":
        return isForm
          ? redirect("profil=limit", "profile-error", serializeProfileDraft(read.body))
          : json(
              429,
              { error: "rate_limited", message: "Za dużo zapisów, spróbuj za chwilę." },
              { "Retry-After": String(outcome.retryAfterSeconds) },
            );
    }
  } catch (error) {
    logFailure("Profile save", error);

    return isForm
      ? redirect("profil=niedostepny", "profile-error")
      : json(503, { error: "unavailable" });
  }
}
