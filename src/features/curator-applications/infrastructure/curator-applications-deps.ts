import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withAdminContext, withUserContext } from "@/lib/db/user-context";

import type { CuratorApplicationsDeps } from "../application/curator-application-types";
import { postgresCuratorApplicationsRepository } from "./postgres-curator-applications";

// The switch of the administrator's panel (D-59). Off unless the variable is exactly "true".
// PR 3 moves the reading into the configuration of the server (`src/lib/config/`, Zod, default
// false) and checks it in the pages and routes first; until then the use cases read it here.
export function isCuratorPanelEnabled(): boolean {
  return process.env.CURATOR_PANEL_ENABLED === "true";
}

// The real dependencies of the curator application use cases.
export function getCuratorApplicationsDeps(): CuratorApplicationsDeps {
  return {
    withUserContext,
    withAdminContext,
    limiter: getActionRateLimiter(),
    repository: postgresCuratorApplicationsRepository,
    panelEnabled: isCuratorPanelEnabled,
  };
}
