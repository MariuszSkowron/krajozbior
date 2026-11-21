import "server-only";

import { withUserContext } from "@/lib/db/user-context";

import type { SettingsDeps } from "../application/settings-types";
import { postgresSettingsRepository } from "./postgres-settings-repository";

// The real dependencies of the account settings use cases.
export function getSettingsDeps(): SettingsDeps {
  return { withUserContext, repository: postgresSettingsRepository };
}
