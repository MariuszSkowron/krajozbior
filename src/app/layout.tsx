import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "@/design-system/tokens/tokens.css";
import "@/design-system/theme/theme.css";

import styles from "./app-shell.module.css";
import { AccountArea } from "./shell/account-area";
import { shellRole } from "./shell/shell-role";

export const metadata: Metadata = {
  title: "Starter",
  description: "Szkielet aplikacji: Next.js, PostgreSQL z regułami dostępu i logowanie.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// The app shell: skip link, header with the application name and the account
// area, the page in <main id="tresc">. Reading the role makes every page render
// per request; src/proxy.ts keeps the role-dependent documents out of shared
// caches.
export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const role = await shellRole();

  return (
    <html lang="pl">
      <body className={styles.shell}>
        <a className={styles.skipLink} href="#tresc">
          Przejdź do treści
        </a>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            Starter
          </Link>
          <AccountArea role={role} />
        </header>
        <main id="tresc" tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </body>
    </html>
  );
}
