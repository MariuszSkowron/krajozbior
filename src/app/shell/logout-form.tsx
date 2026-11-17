import type { ReactNode } from "react";

type LogoutFormProps = Readonly<{
  className: string;
  children: ReactNode;
}>;

// The native logout form (works without JavaScript). Used by every logout
// button: the shell and the account page.
export function LogoutForm({ className, children }: LogoutFormProps) {
  return (
    <form method="post" action="/api/auth/logout">
      <button className={className} type="submit">
        {children}
      </button>
    </form>
  );
}
