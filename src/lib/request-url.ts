// The shell must know the address of the page it draws (F-K3): the legal pages stay
// readable before the terms are accepted. A layout cannot read the address, so the proxy
// (src/proxy.ts) passes it on in this request header on every page request. It overwrites
// whatever a client sent, so a forged value never reaches the shell.
export const REQUEST_URL_HEADER = "x-krajozbior-url";

/** Path and query of the current page; "/" when the proxy did not run (a unit test). */
export function requestUrlFrom(headers: Pick<Headers, "get">): string {
  return headers.get(REQUEST_URL_HEADER) ?? "/";
}
