#!/usr/bin/env python3
"""Fetch VMISS product catalogs with nodriver and Cloudflare checkbox support."""
import asyncio
import json
import os
import sys
import nodriver as uc

CATEGORIES = [
    ("dedicated-hk", "Dedicated Server - HK", "https://app.vmiss.com/store/dedicated-server"),
    ("dedicated-la-9929", "Dedicated Server - LA - 9929", "https://app.vmiss.com/store/dedicated-server-la-9929"),
    ("hk-bgp", "CN - HongKong - BGP", "https://app.vmiss.com/store/cn-hong-kong-bgp"),
    ("hk-bgp-dc2", "CN - HongKong - BGP #DC2", "https://app.vmiss.com/store/cn-hk-bgp-v2"),
    ("hk-intl", "CN - HongKong - INTL", "https://app.vmiss.com/store/cn-hong-kong-intl"),
    ("osaka-iij", "JP - Osaka - IIJ", "https://app.vmiss.com/store/jp-osaka-iij"),
    ("tokyo-bgp", "JP - Tokyo - BGP", "https://app.vmiss.com/store/jp-tokyo-bgp"),
    ("tokyo-iij", "JP - Tokyo - IIJ", "https://app.vmiss.com/store/jp-tokyo-iij"),
    ("tokyo-tri", "JP - Tokyo - TRI", "https://app.vmiss.com/store/jp-tokyo-tri"),
    ("seoul-intl", "KR - Seoul - INTL", "https://app.vmiss.com/store/kr-seoul-intl"),
    ("los-angeles-tri", "US - LosAngeles - TRI", "https://app.vmiss.com/store/us-los-angeles-tri"),
    ("los-angeles-tri-dc2", "US - LosAngeles - TRI #DC2", "https://app.vmiss.com/store/us-los-angeles-bgp"),
    ("los-angeles-9929", "US - LosAngeles - 9929", "https://app.vmiss.com/store/us-los-angeles-9929"),
    ("los-angeles-cmin2", "US - LosAngeles - CMIN2", "https://app.vmiss.com/store/us-los-angeles-cmin2"),
    ("los-angeles-cn2", "US - LosAngeles - CN2 GIA", "https://app.vmiss.com/store/us-los-angeles-cn2"),
    ("others", "Others", "https://app.vmiss.com/store/others"),
]

selected = {value.strip() for value in os.environ.get("VPS_MONITOR_VMISS_CATEGORIES", "").split(",") if value.strip()}
if selected:
    CATEGORIES = [category for category in CATEGORIES if category[0] in selected]

async def fetch(browser, category_id, category_name, url):
    tab = await browser.get(url)
    # Give Cloudflare's frame time to render before nodriver locates its checkbox.
    await asyncio.sleep(8)
    html = await tab.get_content()
    if "Just a moment" in html or "Verifying you are human" in html:
        try:
            await asyncio.wait_for(tab.verify_cf(), timeout=15)
        except Exception:
            # Some non-interactive challenges have no clickable checkbox. They
            # still complete after the browser has remained on the page briefly.
            pass
        await asyncio.sleep(15)
        html = await tab.get_content()
    if "Just a moment" in html or "Verifying you are human" in html:
        raise RuntimeError("Cloudflare 验证未完成")
    return {"categoryId": category_id, "html": html}

async def main():
    result = {"categories": [{"id": key, "name": name, "url": url} for key, name, url in CATEGORIES], "pages": [], "failures": []}
    profile = os.environ.get("VPS_MONITOR_VMISS_PROFILE", "/opt/vps-monitor/data/browser-profiles/vmiss")
    os.makedirs(profile, exist_ok=True)
    browser = await uc.start(headless=False, browser_executable_path="/usr/bin/google-chrome", sandbox=False, user_data_dir=profile)
    try:
        for category_id, category_name, url in CATEGORIES:
            try:
                result["pages"].append(await asyncio.wait_for(
                    fetch(browser, category_id, category_name, url), timeout=45
                ))
            except Exception as error:
                result["failures"].append({"categoryId": category_id, "categoryName": category_name, "error": str(error)[:300]})
    finally:
        browser.stop()
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"fatal": str(error)[:500]}))
        sys.exit(1)
