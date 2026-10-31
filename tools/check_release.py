#!/usr/bin/env python3
"""Validate configuration for a test build or a future production build.

This checks configuration, not successful compilation, purchases, review or
device performance. A release requires the separate documented acceptance tests.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = "3940256099942544"

def check(channel: str) -> list[str]:
    config = json.loads((ROOT / "game/config/runtime.json").read_text())
    catalog = json.loads((ROOT / "game/config/catalog.json").read_text())
    problems: list[str] = []
    def require(condition: bool, message: str) -> None:
        if not condition:
            problems.append(message)
    require(config.get("ads_minimum_age") == 18, "Only adult ads are approved for this audience.")
    require(re.fullmatch(r"[a-z]\w*(\.[a-z]\w*){2,}", config.get("package_name", "")) is not None,
            "Configure a valid final Android application ID.")
    products = {p["id"]: p for p in catalog["products"]}
    for name, amount in [("small", 1000), ("medium", 6000), ("large", 15000)]:
        require(products.get("coin_pack_" + name, {}).get("coins") == amount,
                "Client and backend coin catalogs disagree: " + name)
    if channel == "test":
        require(config.get("test_mode") is True, "The test build must identify itself.")
        require(config.get("starting_coins") == 99999, "Requested test balance is 99,999 coins.")
        require(config.get("live_payments") is False, "Real payments must stay disabled in this test build.")
        for field in ["admob_app_id", "reward_ad_unit", "interstitial_ad_unit"]:
            require(SAMPLE in config.get(field, ""), "Test ads must use Google's official sample IDs.")
    else:
	
        services_source = (ROOT / "game/scripts/services.gd").read_text()
        require("const LIVE_PURCHASE_GRANTS_IMPLEMENTED := false" not in services_source,
                "Complete the live backend client integration before enabling purchases.")
        require(config.get("test_mode") is False, "Disable the preview/test economy.")
        require(config.get("starting_coins") == 0, "Remove the 99,999 test-coin seed.")
        require(".test" not in config.get("package_name", ""), "Choose the owner's final application ID.")
        require(config.get("live_payments") is True, "Complete and validate live payment integration.")
        require(config.get("backend_url", "").startswith("https://"), "Configure the deployed purchase backend.")
        for field, separator in [("admob_app_id", "~"), ("reward_ad_unit", "/"), ("interstitial_ad_unit", "/")]:
            value = config.get(field, "")
            require(re.fullmatch(r"ca-app-pub-\d{16}" + re.escape(separator) + r"\d{10}", value) is not None,
                    "Configure the owner's " + field)
            require(SAMPLE not in value, "Google sample advertising IDs cannot ship as live monetization.")
        for field in ["privacy_policy_url", "developer_website_url"]:
            require(config.get(field, "").startswith("https://"), "Publish and configure " + field)
        require("@" in config.get("support_email", ""), "Configure a public support email.")
        require(config.get("release_acceptance_complete") is True,
                "Complete Play test-track billing/refund/restore and real-device acceptance checks.")
    return problems

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", choices=["test", "release"], default="test")
    args = parser.parse_args()
    errors = check(args.channel)
    if errors:
        for error in errors:
            print("BLOCKED: " + error)
        raise SystemExit(1)
    print(f"PASS: {args.channel} configuration checks. Compilation/device validation are separate.")
