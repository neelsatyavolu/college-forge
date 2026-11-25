/** URL and auth checks for the scraper. Kept free of Worker APIs so node tests can load it. */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** A public http(s) page: no credentials, localhost, internal names, or private IP literals. */
export function isAllowedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return false; // IPv6 literals: none of the pages we read need one
  if (IPV4.test(host)) return !privateV4(host);
  if (!host.includes(".")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host);
}

/** Constant-time compare of the bearer token against the configured secret. */
export function tokensMatch(given: string, expected: string): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
