#!/usr/bin/env python3
"""Check Android source/configuration or build readiness without exposing secrets.

This does not verify live Google/Cloudflare authorization, Android installation,
purchase processing, consent or store approval.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "com.subwayrunner.bd"
PROJECT_ID = "subway-runner-513217"
PROJECT_NUMBER = "613238310945"
FIREBASE_APP_ID = "1:613238310945:android:a6a750a7838becef4bbb60"
SIGNING_NAMES = ("ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD")
VERIFIED_GAMES_ID = "613238310945"


def configured_games_id() -> str:
    if "PLAY_GAMES_APP_ID" in os.environ:
        return os.environ["PLAY_GAMES_APP_ID"]
    properties = ROOT / "android/gradle.properties"
    if properties.is_file():
        match = re.search(r"^playGamesAppId\s*=\s*(\d+)\s*$", properties.read_text(), re.MULTILINE)
        if match:
            return match.group(1)
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-only", action="store_true", help="Validate source; report unavailable SDK/signing as limitations.")
    parser.add_argument("--production", action="store_true", help="Require live ad mode, owner upload signing and actual PGS app_id.")
    parser.add_argument("--require-signing", action="store_true", help="Refuse an unsigned internal-testing AAB.")
    parser.add_argument("--ads-mode", choices=("test", "live"), default=os.environ.get("ADS_MODE", "test"))
    parser.add_argument("--play-games-app-id", default=configured_games_id())
    args = parser.parse_args()
    errors: list[str] = []

    def check(condition: bool, message: str) -> bool:
        print(("PASS: " if condition else "BLOCKED: ") + message)
        if not condition:
            errors.append(message)
        return condition

    for name in ("web/index.html", "web/app.js", "web/simulation.js", "web/renderer.js", "web/assets/models.js",
                 "android/settings.gradle.kts", "android/app/build.gradle.kts", "android/app/src/main/AndroidManifest.xml"):
        check((ROOT / name).is_file(), "Required source file: " + name)

    google_file = ROOT / "android/app/google-services.json"
    if check(google_file.is_file(), "Firebase configuration belongs in the application module"):
        try:
            config = json.loads(google_file.read_text())
            info = config.get("project_info", {})
            check(info.get("project_id") == PROJECT_ID, "Firebase project ID matches supplied owner configuration")
            check(str(info.get("project_number", "")) == PROJECT_NUMBER, "Firebase project number matches")
            clients = [item for item in config.get("client", []) if item.get("client_info", {}).get("android_client_info", {}).get("package_name") == PACKAGE]
            check(len(clients) == 1, "Exactly one Firebase Android client matches the final package")
            if len(clients) == 1:
                check(clients[0].get("client_info", {}).get("mobilesdk_app_id") == FIREBASE_APP_ID, "Firebase Android App ID matches")
            # Public app configuration is needed by Google Services, but API key
            # values and arbitrary configuration content are deliberately not logged.
        except (OSError, ValueError, TypeError):
            check(False, "Firebase configuration must be valid JSON")

    app_gradle = ROOT / "android/app/build.gradle.kts"
    if app_gradle.is_file():
        source = app_gradle.read_text()
        check(PACKAGE in source, "Android application uses final package identity")
        check("com.google.gms.google-services" in source, "Google Services plugin is applied to the application module")

    game_id = args.play_games_app_id.strip()
    if game_id:
        check(re.fullmatch(r"[0-9]{5,32}", game_id) is not None, "Play Games app_id has the expected numeric resource format")
        check(game_id == VERIFIED_GAMES_ID, "Play Games app_id matches the owner's verified Configuration-page ID")
    elif args.source_only:
        print("RUNTIME BLOCKED: actual Play Games app_id/resource export is absent. Cloud project number is not substituted; sign-in must fail safely until configured.")
    else:
        check(False, "Supply PLAY_GAMES_APP_ID from the actual Play Games Android resource export")

    supplied = [bool(os.environ.get(name, "")) for name in SIGNING_NAMES]
    signing_ready = all(supplied)
    if any(supplied) and not signing_ready:
        check(False, "Owner signing configuration must provide all four documented environment variables")
    if signing_ready:
        key_path = Path(os.environ[SIGNING_NAMES[0]])
        check(key_path.is_absolute(), "Owner upload keystore uses an absolute private path")
        check(key_path.is_file(), "Owner upload keystore exists at the configured private path")
        check("LOCAL-TEST" not in key_path.name.upper(), "Local prototype signing identity is not used as the Play upload key")
    elif args.production or args.require_signing:
        check(False, "Production build requires the owner's authorized Play upload signing configuration")
    else:
        print("LIMIT: owner upload signing is unavailable; any release AAB produced without it is unsigned and cannot be uploaded yet.")

    if args.production:
        check(args.ads_mode == "live", "Production explicitly selects owner ad units; internal testing defaults to Google's test units")
    else:
        print("ADS MODE: " + args.ads_mode + "; live rewarded delivery/SSV must be tested separately.")

    java = shutil.which("java")
    gradle = os.environ.get("GRADLE_EXECUTABLE") or shutil.which("gradle")
    sdk_value = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    if not sdk_value and (ROOT.parent / "toolchain/android-sdk").is_dir():
        sdk_value = str(ROOT.parent / "toolchain/android-sdk")
    sdk = Path(sdk_value) if sdk_value else None
    ready = {
        "Java 17+ runtime": bool(java),
        "Gradle executable": bool(gradle and (Path(gradle).is_file() or shutil.which(gradle))),
        "Android API 36 platform": bool(sdk and (sdk / "platforms/android-36/android.jar").is_file()),
        "Android build tools 36.0.0": bool(sdk and (sdk / "build-tools/36.0.0/aapt2").is_file()),
    }
    if java:
        result = subprocess.run([java, "-version"], capture_output=True, text=True, timeout=15)
        version = result.stderr + result.stdout
        match = re.search(r'version "(\d+)', version)
        ready["Java 17+ runtime"] = result.returncode == 0 and match is not None and int(match.group(1)) >= 17
    for label, available in ready.items():
        if args.source_only:
            print(("AVAILABLE: " if available else "BUILD BLOCKED: ") + label)
        else:
            check(available, label)

    print("NOT VERIFIED: SDK compilation, Android install/runtime, upload-key authorization, live auth, purchase verification, rewarded SSV and external deletion/privacy pages.")
    if errors:
        print(f"Preflight blocked by {len(errors)} required source/configuration/build condition(s).")
        return 1
    print("PASS: source preflight." if args.source_only else "PASS: local build prerequisites; this is not a compiled or verified AAB.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
