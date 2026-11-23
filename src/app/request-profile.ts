import { cache } from "react";

import { getRequestActor } from "@/app/request-actor";
import { getMyProfile } from "@/features/profile/application/profile";
import { getProfileDeps } from "@/features/profile/infrastructure/profile-deps";

// One profile read per request, shared by the shell header and the profile page (like
// getRequestActor). Authorization stays in the use case; a guest gets its "unauthenticated" outcome.
export const getRequestProfile = cache(async () =>
  getMyProfile(await getRequestActor(), getProfileDeps()),
);
