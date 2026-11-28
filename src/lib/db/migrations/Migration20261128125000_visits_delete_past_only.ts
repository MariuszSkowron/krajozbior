import { Migration } from "@mikro-orm/migrations";

// Audit F-1: only the API forbade an explorer to delete a visit recorded "on site"; the policy
// and the grant of `visits` allowed it for any own row, so a direct SQL statement of the
// application role could remove it. The delete policy now covers only own `past` visits, the
// same as `deleteMyPastVisits` does. RLS stays enabled and forced, the grant stays (it is the
// policy that narrows it). Deleting an account is not affected: it runs through the foreign key
// `on delete cascade` of `auth.users`, which RLS does not apply to.

export class Migration20261128125000_visits_delete_past_only extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop policy visits_owner_delete on public.visits;`);
    this.addSql(`
      create policy visits_owner_delete on public.visits for delete to krajozbior_app
        using (user_id = (select app_current_user_id()) and kind = 'past');
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop policy visits_owner_delete on public.visits;`);
    this.addSql(`
      create policy visits_owner_delete on public.visits for delete to krajozbior_app
        using (user_id = (select app_current_user_id()));
    `);
  }
}
