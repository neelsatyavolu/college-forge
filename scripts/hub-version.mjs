/**
 * Cloudflare in front of forge.n3el.dev caches .js/.css in browsers for hours
 * regardless of origin headers, so each deploy must reference new URLs. Adds
 * "?v=<version>" to every local script src and stylesheet href in a hub page.
 */
export function stampAssetVersions(html, version) {
  if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new Error(`Invalid asset version: ${version}`);
  return html.replace(/\b(src|href)="(\.{1,2}\/[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?"/g, `$1="$2?v=${version}"`);
}
