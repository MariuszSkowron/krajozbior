import type { ReactNode } from "react";

type LogoutFormProps = Readonly<{
  className: string;
  children: ReactNode;
  /** A same-site path to come back to after signing in again (the deletion screen, E9-5). */
  returnTo?: string;
}>;

// The native logout form (works without JavaScript). Used by every logout
// button: the shell and the account page.
export function LogoutForm({ className, children, returnTo }: LogoutFormProps) {
  return (
    <form method="post" action="/api/auth/logout">
      {returnTo === undefined ? null : <input type="hidden" name="returnTo" value={returnTo} />}
      <button className={className} type="submit">
        {children}
      </button>
    </form>
  );
}
