#!/usr/bin/env bash
# Reproducible real SDK build. Does not generate substitute APK/AAB archives.
set -euo pipefail

task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
channel="internal"
require_signing=false
ads_mode="${ADS_MODE:-test}"
while (($#)); do
  case "$1" in
    --production) channel="production"; ads_mode="live"; require_signing=true ;;
    --require-signing) require_signing=true ;;
    --ads-mode) shift; ads_mode="${1:?Expected test or live}" ;;
    --help)
      echo 'Usage: bash tools/build_android.sh [--require-signing] [--production] [--ads-mode test|live]'
      exit 0 ;;
    *) echo "Unknown build argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$ads_mode" in test|live) ;; *) echo 'ADS_MODE must be test or live' >&2; exit 2 ;; esac

preflight=(python3 "$task_root/tools/preflight_android.py" --ads-mode "$ads_mode")
gradle_args=(--no-daemon --stacktrace "-PadsMode=$ads_mode")
if [[ -n "${PLAY_GAMES_APP_ID:-}" ]]; then
  preflight+=(--play-games-app-id "$PLAY_GAMES_APP_ID")
  gradle_args+=("-PplayGamesAppId=$PLAY_GAMES_APP_ID")
fi
if [[ "$channel" == production ]]; then
  preflight+=(--production)
  gradle_args+=(-Pproduction=true)
fi
if [[ "$require_signing" == true ]]; then
  preflight+=(--require-signing)
  gradle_args+=(-PrequireSigning=true)
fi
"${preflight[@]}"

gradle_bin="${GRADLE_EXECUTABLE:-gradle}"
cd "$task_root/android"
"$gradle_bin" "${gradle_args[@]}" :app:testDebugUnitTest :app:lintDebug :app:bundleRelease

bundle="$task_root/android/app/build/outputs/bundle/release/app-release.aab"
if [[ ! -s "$bundle" ]]; then
  echo 'Build did not produce the expected real Android App Bundle.' >&2
  exit 1
fi
mkdir -p "$task_root/release"
destination="$task_root/release/Subway-Runner-$channel.aab"
verification_report="$task_root/release/.bundle-verification.json"

verification=(python3 "$task_root/tools/verify_aab.py" "$bundle" --report "$verification_report")
if [[ -n "${ANDROID_KEYSTORE_PATH:-}" && -n "${ANDROID_KEYSTORE_PASSWORD:-}" && -n "${ANDROID_KEY_ALIAS:-}" && -n "${ANDROID_KEY_PASSWORD:-}" ]]; then
  "${verification[@]}" --check-configured-keystore
  echo 'Release signing configured. Confirm this certificate is the Play Console authorized upload certificate before upload.'
else
  if [[ "$require_signing" == true ]]; then
    echo 'Signed release was required, but its signing identity is unavailable.' >&2
    exit 1
  fi
  "${verification[@]}" --allow-unsigned
  echo 'UNSIGNED AAB: compilation succeeded, but this artifact cannot be uploaded until signed with the authorized upload key.'
fi
cp -- "$bundle" "$destination"
python3 - "$destination" "$verification_report" <<'PY'
from pathlib import Path
import hashlib
import json
import sys
p = Path(sys.argv[1])
report_path = Path(sys.argv[2])
report = json.loads(report_path.read_text())
report['artifact'] = str(p)
p.with_suffix(p.suffix + '.build.json').write_text(json.dumps(report, indent=2) + '\n')
report_path.unlink()
digest = hashlib.sha256(p.read_bytes()).hexdigest()
p.with_suffix(p.suffix + '.sha256').write_text(digest + '  ' + p.name + '\n')
print(f'AAB produced: {p} ({p.stat().st_size:,} bytes)')
print('Android/Play internal testing and backend end-to-end validation are still required.')
PY
