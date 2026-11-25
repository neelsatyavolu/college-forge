# /// script
# requires-python = ">=3.10"
# dependencies = ["curl_cffi>=0.7", "html2text>=2024.2"]
# ///
"""Read a page as markdown without Firecrawl cloud, for the school research agents.

Tries the local firecrawl-local scraper first (with FIRECRAWL_CLOUD=off, so nothing spends
credits). When that returns a bot-check or "Access denied" page, it fetches again with
curl_cffi impersonating Chrome's TLS and HTTP/2 fingerprint, which gets past many
Akamai/Cloudflare checks, and converts the HTML to markdown.

    uv run scripts/research/fetch.py <url> > page.md
    uv run scripts/research/fetch.py --pdf <url> > cds.txt   # PDF text with layout kept (CDS checkboxes)

PDFs are left to firecrawl-local (it reads them locally). Exit code 2: still blocked.
"""
import os
import re
import subprocess
import sys

BLOCKED = re.compile(
    r"(access denied|attention required|just a moment|verify you are human|verifying you are human|"
    r"checking your browser|are you a robot|unusual traffic|pardon our interruption|request rejected|"
    r"security checkpoint|enable javascript and cookies)",
    re.I,
)
FIRECRAWL = os.path.expanduser("~/.cargo/bin/firecrawl-local")


def blocked(text: str) -> bool:
    head = text[:1500]
    return len(text.strip()) < 200 or bool(BLOCKED.search(head))


def local_scrape(url: str) -> str:
    env = {**os.environ, "FIRECRAWL_CLOUD": "off"}
    try:
        out = subprocess.run(
            [FIRECRAWL, "scrape", "--markdown", "--public-only", url],
            capture_output=True, text=True, timeout=90, env=env,
        )
        return out.stdout
    except Exception:
        return ""


def impersonated(url: str) -> str:
    from curl_cffi import requests
    import html2text

    r = requests.get(url, impersonate="chrome", timeout=30, allow_redirects=True)
    kind = r.headers.get("content-type", "")
    if "pdf" in kind:
        return ""
    conv = html2text.HTML2Text()
    conv.body_width = 0
    conv.ignore_images = True
    html = re.sub(r"(?is)<(script|style|noscript|svg|nav|footer)[^>]*>.*?</\1>", "", r.text)
    main = re.search(r"(?is)<main[^>]*>.*?</main>", html)
    return f"<!-- source: {r.url} (HTTP {r.status_code}) -->\n" + conv.handle(main.group(0) if main else html)


def pdf_layout(url: str) -> int:
    """Downloads a PDF (Chrome-impersonating) and prints pdftotext -layout output, which keeps
    table columns and X marks that plain extraction drops."""
    import tempfile
    from curl_cffi import requests

    r = requests.get(url, impersonate="chrome", timeout=60, allow_redirects=True)
    if r.status_code != 200 or not r.content.startswith(b"%PDF"):
        print(f"not a PDF (HTTP {r.status_code})", file=sys.stderr)
        return 2
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(r.content)
        f.flush()
        out = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True, timeout=120)
    if out.returncode != 0 or not out.stdout.strip():
        print("pdftotext could not read it", file=sys.stderr)
        return 2
    sys.stdout.write(out.stdout)
    return 0


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "--pdf" and re.match(r"^https?://", sys.argv[2]):
        return pdf_layout(sys.argv[2])
    if len(sys.argv) != 2 or not re.match(r"^https?://", sys.argv[1]):
        print("usage: fetch.py [--pdf] <http(s) url>", file=sys.stderr)
        return 1
    url = sys.argv[1]
    text = local_scrape(url)
    if text and not blocked(text):
        sys.stdout.write(text)
        return 0
    try:
        text = impersonated(url)
    except Exception as e:  # network errors: report, don't crash the agent's pipeline
        print(f"fetch failed: {e.__class__.__name__}", file=sys.stderr)
        return 2
    if not text or blocked(text):
        print("still blocked: try another page for this fact", file=sys.stderr)
        return 2
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
