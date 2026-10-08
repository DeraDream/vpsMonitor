#!/usr/bin/env python3
"""Fetch V.PS catalog pages through Camoufox and return their rendered HTML."""
import json
import sys
from camoufox.sync_api import Camoufox

GROUPS = [
    ("performance-kvm-vps", "Performance KVM VPS", "https://vps.hosting/cart/performance-kvm-vps/"),
    ("edge-kvm-vps", "Edge KVM VPS", "https://vps.hosting/cart/edge-kvm-vps/"),
    ("cloud-kvm-vps", "Cloud KVM VPS", "https://vps.hosting/cart/cloud-kvm-vps/"),
    ("storage-kvm-vps", "Storage KVM VPS", "https://vps.hosting/cart/storage-kvm-vps/"),
]

def page_locations(page, fallback_name, fallback_url):
    links = page.locator("a.cart-category[href]").evaluate_all("items => items.map(item => ({name: item.innerText.trim(), url: item.href}))")
    return links or [{"id": fallback_name.lower().replace(" ", "-"), "name": fallback_name, "url": fallback_url}]

def load_catalog(page, url):
    last_error = None
    for _ in range(3):
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            page.locator(".cart-product").first.wait_for(timeout=20000)
            if "Just a moment" not in page.title() and page.locator(".cart-product").count(): return page.content()
        except Exception as error:
            last_error = error
        page.wait_for_timeout(1500)
    raise RuntimeError(f"未获得套餐卡片：{last_error}")

def main():
    result = {"categories": [{"id": key, "name": name, "url": url} for key, name, url in GROUPS], "pages": [], "failures": []}
    with Camoufox(headless=True, humanize=True, locale="en-US") as browser:
        context = browser.new_context()
        page = context.new_page()
        for category_id, category_name, url in GROUPS:
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(500)
                locations = page_locations(page, category_name, url)
                for location in locations:
                    html = load_catalog(page, location["url"])
                    result["pages"].append({"categoryId": category_id, "location": location["name"], "url": location["url"], "html": html})
            except Exception as error:
                result["failures"].append({"categoryId": category_id, "categoryName": category_name, "error": str(error)[:300]})
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"fatal": str(error)[:500]}))
        sys.exit(1)
