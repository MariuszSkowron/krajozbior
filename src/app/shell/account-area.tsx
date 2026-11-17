import type { Role } from "@/features/identity/domain/actor";
import { roleLabels } from "@/features/identity/domain/role-home";

import styles from "../app-shell.module.css";
import { LoginLink } from "./login-link";
import { LogoutForm } from "./logout-form";

// Account area next to the application name: the role and "Wyloguj" for a
// signed-in user, "Zaloguj się" for a guest. Logging out is a native form, so
// it works without JavaScript.
export function AccountArea({ role }: Readonly<{ role: Role | null }>) {
  return (
    <div className={styles.account}>
      {role === null ? (
        <LoginLink />
      ) : (
        <>
          <p className={styles.role}>
            <span className={styles.visuallyHidden}>Twoja rola: </span>
            {roleLabels[role]}
          </p>
          <LogoutForm className={styles.accountAction}>Wyloguj</LogoutForm>
        </>
      )}
    </div>
  );
}
