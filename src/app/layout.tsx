import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

import "@/design-system/tokens/tokens.css";
import "@/design-system/theme/theme.css";

import { isLegalPath } from "@/features/legal/domain/legal-pages";
import { requestUrlFrom } from "@/lib/request-url";

import styles from "./app-shell.module.css";
import { geist, geistMono, instrumentSerif } from "./fonts";
import { AccountArea } from "./shell/account-area";
import { MainNav } from "./shell/main-nav";
import { SiteFooter } from "./shell/site-footer";
import { shellTermsAccepted } from "./shell/terms-state";
import { TermsGate } from "./shell/terms-gate";
import { TestVersionBanner } from "./shell/test-version-banner";
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
// area, the main navigation of a signed-in explorer (bottom bar on a phone, side
// menu on a computer), the page in <main id="tresc">. Reading the role makes every page render
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
  // Until the current terms are accepted a signed-in account sees only the "Zanim zaczniesz"
  // screen and the logout button; the legal pages stay readable (F-K3, E11-Q4 A).
  const termsAccepted = role === null ? true : await shellTermsAccepted();
  const url = requestUrlFrom(await headers());
  const showGate = !termsAccepted && !isLegalPath(url);
  const showNav = role !== null && termsAccepted;

  return (
    <html
      lang="pl"
      className={`theme-${theme} ${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body className={showNav ? `${styles.shell} ${styles.withNav}` : styles.shell}>
        <a className={styles.skipLink} href="#tresc">
          Przejdź do treści
        </a>
        <div className={styles.top}>
          <TestVersionBanner />
          <header className={styles.header}>
            <Link className={styles.brand} href="/">
              Krajozbiór
            </Link>
            <div className={styles.headerEnd}>
              <ThemeSwitch theme={theme} />
              <AccountArea role={role} curatorLink={showNav && curatorLink} />
            </div>
          </header>
        </div>
        {showNav ? <MainNav /> : null}
        <main id="tresc" tabIndex={-1} className={styles.main}>
          {showGate ? <TermsGate url={url} /> : children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
