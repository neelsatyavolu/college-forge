# Self-hosted Firecrawl for web research

Forge's copilot and "Estimate my chances" research schools with `web_search` and `web_fetch`. Besides Exa and TinyFish, they can use your own [Firecrawl](https://github.com/firecrawl/firecrawl) server. Vercel can't run it (it needs Docker, Redis and a headless browser), so it runs on a separate machine.

## Run the server

On a Linux box with Docker:

```bash
git clone https://github.com/firecrawl/firecrawl.git
cd firecrawl
cp apps/api/.env.example .env   # set USE_DB_AUTHENTICATION=false; set BULL_AUTH_KEY to a random value
docker compose up -d            # API on port 3002
```

Search on a self-hosted server needs a search backend. Set `SEARXNG_ENDPOINT` in `.env` to a SearXNG instance, or leave it unset and Forge keeps using Exa and TinyFish for search while Firecrawl reads pages.

Put it behind HTTPS (Caddy or a Cloudflare Tunnel) and require a bearer token at the proxy. A self-hosted Firecrawl does not check API keys on its own.

## Point Forge at it

```bash
vercel env add FIRECRAWL_API_URL production   # e.g. https://crawl.example.com
vercel env add FIRECRAWL_API_KEY production   # the bearer token your proxy checks
```

Forge calls `POST /v2/search` and `POST /v2/scrape` on that one host. Before passing a page to Firecrawl, Forge refuses localhost, internal names and private IP addresses. That check can't see where a public name resolves or where a page redirects, so network isolation is required, not optional: run Firecrawl on a box or VLAN that can reach only the internet, with no route to your other machines, your router, or a cloud metadata endpoint (169.254.169.254).

When it's configured, `web_fetch` reads pages through Firecrawl first and falls back to TinyFish. `web_search` merges Firecrawl's results after Exa's and TinyFish's, and reads the top pages through Firecrawl when TinyFish isn't set.

## Or: the Cloudflare Worker in `workers/scraper`

`workers/scraper` is a small Worker that answers `POST /v2/scrape` the same way, so Forge needs no code changes. It fetches the page directly, falls back to Cloudflare Browser Rendering for pages drawn by scripts or blocked by bot checks, converts the HTML to markdown, and caches results in KV for 3 days. It has no `/v2/search`; Forge keeps searching through Exa and TinyFish.

```bash
cd workers/scraper && npm install
wrangler kv namespace create forge-scraper-pages   # put the id in wrangler.jsonc
openssl rand -hex 32 | wrangler secret put SCRAPER_TOKEN
wrangler deploy
```

Then set `FIRECRAWL_API_URL` to the Worker's URL and `FIRECRAWL_API_KEY` to the same token. Browser Rendering is billed by browser time after the free allowance.
