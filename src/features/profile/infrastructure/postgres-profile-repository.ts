import "server-only";

import { isRegion } from "@/features/catalog/domain/collection";

import type { ProfileRepository } from "../application/profile-types";
import type { Profile } from "../domain/profile";

// Raw SQL on the transaction of the use case (user context). No statement takes
// a user id: the owner of the row is the default of `user_id`
// (app_current_user_id()), and the row policies of `profiles` (owner only)
// decide what is read or written. `on conflict (user_id)` can only meet the
// actor's own row: a row of somebody else is invisible to the policies.

type Row = {
  firstName: string | null;
  familyInitial: string | null;
  region: string | null;
  visibility: "private" | "public";
};

const columns = `first_name as "firstName", family_initial as "familyInitial", region, visibility`;

function toProfile(row: Row): Profile {
  return {
    firstName: row.firstName,
    familyInitial: row.familyInitial,
    // The CHECK keeps the stored value on the list; an unknown one would be a defect, not a region.
    region: isRegion(row.region) ? row.region : null,
    visibility: row.visibility,
  };
}

export const postgresProfileRepository: ProfileRepository = {
  async read(tx) {
    const rows = await tx.em.execute<Row[]>(
      `select ${columns} from public.profiles where user_id = app_current_user_id()`,
    );

    return rows[0] === undefined ? null : toProfile(rows[0]);
  },

  async save(tx, profile) {
    const rows = await tx.em.execute<Row[]>(
      `insert into public.profiles (first_name, family_initial, region, visibility)
       values (?, ?, ?, ?)
       on conflict (user_id) do update
         set first_name = excluded.first_name,
             family_initial = excluded.family_initial,
             region = excluded.region,
             visibility = excluded.visibility,
             updated_at = now()
       returning ${columns}`,
      [profile.firstName, profile.familyInitial, profile.region, profile.visibility],
    );

    return toProfile(rows[0]!);
  },
};
