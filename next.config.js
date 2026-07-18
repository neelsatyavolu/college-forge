/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // The hub UI is the static React kit under /public/hub.
    return [{ source: "/", destination: "/hub/index.html", permanent: false }];
  },
};

module.exports = nextConfig;
