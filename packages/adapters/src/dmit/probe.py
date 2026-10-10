#!/usr/bin/env python3
"""Fetch DMIT's Cloudflare-protected pricing page in a rendered browser."""
import json
import sys
from camoufox.sync_api import Camoufox

URL = "https://www.dmit.io/pages/pricing?language=english"
CHALLENGE_MARKERS = ("Just a moment", "Verifying you are human", "cf-chl-", "challenge-platform")

def challenged(page, html):
    return page.title().strip() == "Just a moment..." or any(marker in html for marker in CHALLENGE_MARKERS)

def main():
    last_error = None
    with Camoufox(headless=True, humanize=True, locale="en-US") as browser:
        context = browser.new_context()
        page = context.new_page()
        for attempt in range(4):
            try:
                page.goto(URL, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(7000 + attempt * 2500)
                html = page.content()
                if not challenged(page, html) and "Order Now" in html:
                    print(json.dumps({"html": html}, ensure_ascii=False))
                    return
                last_error = "Cloudflare 验证尚未完成" if challenged(page, html) else "价格页未出现订购按钮"
            except Exception as error:
                last_error = str(error)
            page.wait_for_timeout(2000)
    raise RuntimeError(last_error or "未获取到 DMIT 价格页")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"fatal": str(error)[:500]}, ensure_ascii=False))
        sys.exit(1)
