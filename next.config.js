/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
