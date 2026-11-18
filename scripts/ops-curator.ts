// Audited operator command for curators and organizations (D-T7). Connects as
// krajozbior_owner (DATABASE_MIGRATION_URL), like `npm run auth:create-admin`:
// it reads auth.users by e-mail, which krajozbior_ops cannot. It never creates
// an account: a person signs in first. Prints a JSON result on stdout (no
// e-mails, URLs or secrets) and short Polish hints on stderr. Exit codes:
// 0 applied/noop, 2 input error, 3 domain refusal, 1 infrastructure failure.
//
// Run with:
//   npm run ops:curator -- grant --org-slug <slug> --email <e-mail> --reason "<powód>" [--name "<nazwa>" --kind <rodzaj>]
//   npm run ops:curator -- revoke --org-slug <slug> --email <e-mail> --reason "<powód>"
//   npm run ops:curator -- suspend --org-slug <slug> --reason "<powód>"
//   npm run ops:curator -- approve --org-slug <slug> --reason "<powód>"
// --operator <etykieta> is a declared label (default: $USERNAME / $USER).
import { runOpsCurator } from "../src/features/organizations/application/ops-curator-command";
import { connectOpsCurator } from "../src/features/organizations/infrastructure/postgres-ops-curator";
import { getMigrationEnv } from "../src/lib/config/env";

async function main() {
  const output = await runOpsCurator(process.argv.slice(2), {
    getConnectionString: () => getMigrationEnv().DATABASE_MIGRATION_URL,
    connect: connectOpsCurator,
    defaultOperator: process.env.USERNAME ?? process.env.USER,
  });

  for (const line of output.stdout) console.log(line);
  for (const line of output.stderr) console.error(line);
  process.exitCode = output.exitCode;
}

main().catch(() => {
  console.error("ops:curator przerwany nieoczekiwanym błędem.");
  process.exitCode = 1;
});
