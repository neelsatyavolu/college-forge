/** @type {import('next').NextConfig} */
// Hub code lives at unversioned URLs, so a cached copy outlives a deploy and
// runs against the new API. Revalidate on every load (ETag makes it a 304).
const REVALIDATE = [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      { source: "/hub/:path*", headers: REVALIDATE },
      { source: "/styles.css", headers: REVALIDATE },
      { source: "/_ds_bundle.js", headers: REVALIDATE },
    ];
  },
  async redirects() {
    // The hub UI is the static React kit under /public/hub.
    return [
      { source: "/", destination: "/hub/index.html", permanent: false },
      // Common typo from the rankings launch brief
      { source: "/rankigngs", destination: "/rankings", permanent: false },
      { source: "/ranking", destination: "/rankings", permanent: false },
    ];
  },
};

module.exports = nextConfig;
