import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import "@/design-system/tokens/tokens.css";
import "@/design-system/theme/theme.css";

import styles from "./app-shell.module.css";
import { geist, geistMono, instrumentSerif } from "./fonts";
import { AccountArea } from "./shell/account-area";
import { requestTheme, themeColor } from "./shell/theme";
import { ThemeSwitch } from "./shell/theme-switch";
import { shellCuratorLink } from "./shell/shell-curator";
import { shellRole } from "./shell/shell-role";

export const metadata: Metadata = {
  title: "Krajozbiór",
  description: "Szkielet aplikacji: Next.js, PostgreSQL z regułami dostępu i logowanie.",
};

// The bar colour of the browser follows the theme cookie, so the viewport is dynamic.
export async function generateViewport(): Promise<Viewport> {
  const theme = await requestTheme();

  return {
    width: "device-width",
    initialScale: 1,
    themeColor: themeColor[theme],
    colorScheme: theme,
  };
}

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
  const curatorLink = await shellCuratorLink(role);
  const theme = await requestTheme();

  return (
    <html
      lang="pl"
      className={`theme-${theme} ${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body className={styles.shell}>
        <a className={styles.skipLink} href="#tresc">
          Przejdź do treści
        </a>
        <header className={styles.header}>
          <Link className={styles.brand} href="/">
            Krajozbiór
          </Link>
          <div className={styles.headerEnd}>
            <ThemeSwitch theme={theme} />
            <AccountArea role={role} curatorLink={curatorLink} />
          </div>
        </header>
        <main id="tresc" tabIndex={-1} className={styles.main}>
          {children}
        </main>
      </body>
    </html>
  );
}
