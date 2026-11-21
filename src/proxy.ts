import { NextResponse, type NextRequest } from "next/server";

import { REQUEST_URL_HEADER } from "@/lib/request-url";

// Every page carries the app shell drawn for the signed-in role, so no page
// response (HTML document or RSC payload) may be kept by a shared cache: each
// one gets `Cache-Control: private, no-store`. Next.js keeps a header set here
// instead of its own. The security headers come from next.config.ts and are not
// touched. Add route-specific checks (status codes, redirects) here when a
// product page needs them.
const PRIVATE_NO_STORE = "private, no-store";

export function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set(REQUEST_URL_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set("Cache-Control", PRIVATE_NO_STORE);

  return response;
}

export const config = {
  // Every page route: not the API (it sets its own cache headers), not the
  // build output under /_next and not a static file from public/. Static files
  // are recognised by a closed list of asset extensions, not by "any dot": a
  // page path may contain a dot (`/u/jan.kowalski`) and must still get
  // `private, no-store`. A new kind of public asset adds its extension here.
  matcher: [
    "/((?!api(?:/|$)|_next/|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|txt|xml|webmanifest|css|js|map|woff2?)$).*)",
  ],
};
