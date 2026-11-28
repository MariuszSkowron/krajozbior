import "server-only";

import { getActionRateLimiter } from "@/features/identity/infrastructure";
import { withUserContext } from "@/lib/db/user-context";

import type { ReportsDeps } from "../application/report-types";
import { postgresReportsRepository } from "./postgres-reports-repository";

// The real dependencies of the use cases of the queue of reports.
export function getReportsDeps(): ReportsDeps {
  return {
    limiter: getActionRateLimiter(),
    withUserContext,
    repository: postgresReportsRepository,
  };
}
