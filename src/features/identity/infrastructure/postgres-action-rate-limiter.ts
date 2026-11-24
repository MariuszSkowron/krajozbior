import "server-only";

import type { Pool } from "pg";

import {
  ACTION_KEY_PREFIX,
  assertValidLimit,
  decideAction,
  type ActionLimit,
  type ActionRateLimiter,
} from "../domain/action-rate-limit";
import type { ThrottleDecision } from "../domain/sign-in-throttle";

type Row = { attempts: number; elapsed_ms: number };

// One atomic upsert per request: a new window starts when the stored one has
// ended. A refused request still counts, but never extends the window. The key
// holds only the action name and the user id (no email, no IP). The fixed
// `action:` prefix keeps it apart from the sign-in buckets (`account_ip:`,
// `account:`, `ip:`) whatever an action is called.
const keyPrefix = ACTION_KEY_PREFIX;
export class PostgresActionRateLimiter implements ActionRateLimiter {
  constructor(private readonly pool: () => Promise<Pool>) {}

  async reserve(action: string, subject: string, limit: ActionLimit): Promise<ThrottleDecision> {
    assertValidLimit(limit);

    const { rows } = await (
      await this.pool()
    ).query<Row>(
      `insert into auth.sign_in_throttle as t (key, attempts, window_started_at)
       values ($1, 1, now())
       on conflict (key) do update
         set attempts = case when t.window_started_at <= now() - make_interval(secs => $2)
                             then 1 else t.attempts + 1 end,
             window_started_at = case when t.window_started_at <= now() - make_interval(secs => $2)
                                      then now() else t.window_started_at end
       returning attempts,
                 extract(epoch from (now() - window_started_at)) * 1000 as elapsed_ms`,
      [`${keyPrefix}${action}:${subject}`, limit.windowSeconds],
    );
    const { attempts, elapsed_ms: elapsedMs } = rows[0];
    const decision = decideAction(attempts, Number(elapsedMs), limit);

    if (!decision.allowed) {
      console.warn(
        JSON.stringify({
          event: "action.rate_limited",
          action,
          retryAfterSeconds: decision.retryAfterSeconds,
        }),
      );
    }

    return decision;
  }
}
