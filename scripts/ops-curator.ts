// Audited operator command for curators and organizations (D-T7). Connects as
// krajozbior_ops (DATABASE_OPS_URL; D-21): that role writes the audit but cannot
// change or switch it off, and finds an account by e-mail only through the
// function ops_find_user. It never creates an account: a person signs in first. Prints a JSON result on stdout (no
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
import { getOpsEnv } from "../src/lib/config/env";

async function main() {
  const output = await runOpsCurator(process.argv.slice(2), {
    getConnectionString: () => getOpsEnv().DATABASE_OPS_URL,
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
