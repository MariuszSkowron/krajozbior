import { Client } from "pg";

import { DEMO_EMAIL_DOMAIN } from "../src/features/identity/domain/demo-account-list";
import { CURRENT_TERMS_VERSION } from "../src/features/terms/domain/terms-version";
import { parseE2eAdminDatabaseUrl } from "../tests/support/e2e-database-url";

// F-K3: a signed-in account without the acceptance of the current terms sees only the screen
// „Zanim zaczniesz”. The specs that sign in with the seeded demo accounts test other screens,
// so the demo accounts get the acceptance before the run, straight in the disposable E2E
// database (admin connection, like the other specs). The screen itself is tested by
// e2e/terms-acceptance.spec.ts with accounts it creates and that nobody pre-accepts. Without a
// database (the specs that need it are skipped then) there is nothing to do.
export default async function globalSetup() {
  const url = process.env.DATABASE_ADMIN_URL;

  if (!process.env.DEMO_ACCOUNT_PASSWORD || url === undefined) {
    return;
  }

  const client = new Client({ connectionString: parseE2eAdminDatabaseUrl(url) });

  await client.connect();
  try {
    await client.query(
      `insert into public.terms_acceptance (user_id, terms_version)
       select id, $1 from auth.users where email like $2
       on conflict do nothing`,
      [CURRENT_TERMS_VERSION, `%@${DEMO_EMAIL_DOMAIN}`],
    );
  } finally {
    await client.end();
  }
}
