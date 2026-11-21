// Security headers of every response (issue #67, OWASP A05). Static, set in
// `next.config.ts`, so `src/proxy.ts` stays free for routing and cache rules.
//
// The CSP has no nonce: Next.js emits inline bootstrap scripts and styles, and
// a nonce would force dynamic rendering and a proxy on every route. The policy
// therefore allows 'unsafe-inline' for scripts and styles but still blocks
// framing, foreign origins, plugins, base-tag and form-target tricks
// (a deliberate trade-off; revisit it if a nonce is worth the dynamic rendering).

export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

export function contentSecurityPolicy(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    // React needs eval in development only (error stack reconstruction).
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // The collection map (E12-5, D-35) loads tiles from this one host, nothing else.
    "img-src 'self' data: blob: https://tile.openstreetmap.org",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  return directives.join("; ");
}

// `source` of the page rule: every path except `/media` and `/media/...`. The route under `media`
// answers all of them (never HTML). A page whose name only starts with `media` (`/media-kit`) is
// still a page.
export const PAGES_SOURCE = "/((?!media(?:/|$)).*)";
export const MEDIA_SOURCE = "/media/:path*";

export function securityHeaders(isDev: boolean): HeaderRule[] {
  const common = [
    // Fallback of frame-ancestors for old browsers.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=()",
    },
    // Not in development: `next dev --experimental-https` would pin HSTS on
    // localhost for a year. No includeSubDomains/preload: irreversible,
    // decided with the domain.
    ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]),
  ];

  return [
    // Every path except /media: the page policy.
    {
      source: PAGES_SOURCE,
      headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy(isDev) }, ...common],
    },
    // /media (E4-2b): a header from next.config replaces the same header of the route, so the page
    // policy would replace the policy of a photo (`default-src 'none'; sandbox`, set by the route).
    // The photo route keeps its own single Content-Security-Policy; the rest stays the same.
    { source: MEDIA_SOURCE, headers: common },
  ];
}
