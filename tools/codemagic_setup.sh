#!/usr/bin/env bash
# Codemagic injects the owner's existing upload keystore; this script creates no key.
set +x
set -euo pipefail

task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${CM_BUILD_DIR:?This setup runs inside a Codemagic build}"
: "${CM_ENV:?Codemagic must provide its environment file}"

# Stop before SDK downloads or tests if the managed signing identity is missing.
for signing_name in CM_KEYSTORE_PATH CM_KEYSTORE_PASSWORD CM_KEY_ALIAS CM_KEY_PASSWORD; do
  if [[ -z "${!signing_name:-}" ]]; then
    echo "Missing $signing_name. Upload the existing authorized upload keystore in Codemagic with reference subway_runner_upload." >&2
    exit 1
  fi
done
if [[ "$CM_KEYSTORE_PATH" != /* ]]; then
  echo 'The managed upload keystore path must be absolute.' >&2
  exit 1
fi
case "${CM_KEYSTORE_PATH##*/}" in
  *[Ll][Oo][Cc][Aa][Ll][-_][Tt][Ee][Ss][Tt]*)
    echo 'A LOCAL-TEST keystore cannot sign a Play upload. Select the existing authorized owner upload key.' >&2
    exit 1 ;;
esac
if [[ ! -f "$CM_KEYSTORE_PATH" || ! -s "$CM_KEYSTORE_PATH" || ! -r "$CM_KEYSTORE_PATH" ]]; then
  echo 'The managed upload keystore is missing, empty, or unreadable.' >&2
  exit 1
fi

for required_tool in python3 java javac curl unzip; do
  if ! command -v "$required_tool" >/dev/null 2>&1; then
    echo "Missing required build tool: $required_tool" >&2
    exit 1
  fi
done
if [[ "$(javac -version 2>&1)" != javac\ 17* ]]; then
  echo 'This build requires JDK 17. Set environment.java to 17 in codemagic.yaml.' >&2
  exit 1
fi

# Project-wide builds prevent version collisions across Codemagic workflows.
# An explicit override supports an app that already has a higher Play version.
ANDROID_VERSION_CODE="$(python3 - <<'PY'
import os
import re

override = os.environ.get('ANDROID_VERSION_CODE', '')
if override:
    if not re.fullmatch(r'[0-9]{1,10}', override):
        raise SystemExit('ANDROID_VERSION_CODE must be an integer from 1 through 2100000000.')
    version = int(override)
else:
    counter = os.environ.get('PROJECT_BUILD_NUMBER') or os.environ.get('BUILD_NUMBER', '')
    if not re.fullmatch(r'[0-9]{1,10}', counter):
        raise SystemExit('Codemagic build counter is missing or invalid; set a valid ANDROID_VERSION_CODE override.')
    version = 100 + int(counter)
if not 1 <= version <= 2100000000:
    raise SystemExit('Computed ANDROID_VERSION_CODE must be from 1 through 2100000000.')
print(version)
PY
)"
export ANDROID_VERSION_CODE

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$sdk_root" || ! -d "$sdk_root" ]]; then
  echo 'The Codemagic Android SDK is unavailable. Check ANDROID_SDK_ROOT / ANDROID_HOME and the build image.' >&2
  exit 1
fi
sdkmanager_bin="$sdk_root/cmdline-tools/latest/bin/sdkmanager"
if [[ ! -x "$sdkmanager_bin" ]]; then
  sdkmanager_bin="$(command -v sdkmanager || true)"
fi
if [[ -z "$sdkmanager_bin" || ! -x "$sdkmanager_bin" ]]; then
  echo 'Android SDK command-line tools (sdkmanager) are missing from the build image.' >&2
  exit 1
fi

# Only sdkmanager's status matters: yes normally exits with SIGPIPE once it closes stdin.
set +e
yes | "$sdkmanager_bin" --sdk_root="$sdk_root" --licenses >/dev/null
license_status="${PIPESTATUS[1]}"
set -e
if [[ "$license_status" -ne 0 ]]; then
  echo 'Android SDK license acceptance failed.' >&2
  exit "$license_status"
fi
"$sdkmanager_bin" --sdk_root="$sdk_root" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'

# AGP 8.10.1 requires a newer Gradle than some Codemagic image defaults.
# Official binary checksum: https://gradle.org/release-checksums/#8.14.3
gradle_version='8.14.3'
gradle_sha256='bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531'
download_dir="$task_root/.ci/downloads"
toolchain_dir="$task_root/.ci/toolchains"
gradle_archive="$download_dir/gradle-$gradle_version-bin.zip"
gradle_home="$toolchain_dir/gradle-$gradle_version"
mkdir -p "$download_dir" "$toolchain_dir"

verify_gradle_archive() {
  python3 - "$gradle_archive" "$gradle_sha256" <<'PY'
from hashlib import sha256
from pathlib import Path
import sys
path = Path(sys.argv[1])
if not path.is_file():
    raise SystemExit(1)
digest = sha256()
with path.open('rb') as archive:
    for block in iter(lambda: archive.read(1024 * 1024), b''):
        digest.update(block)
raise SystemExit(0 if digest.hexdigest() == sys.argv[2] else 1)
PY
}

if ! verify_gradle_archive; then
  rm -f -- "$gradle_archive" "$gradle_archive.part"
  curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 30 --max-time 600 --retry 3 --retry-delay 3 --retry-max-time 900 \
    "https://services.gradle.org/distributions/gradle-$gradle_version-bin.zip" \
    --output "$gradle_archive.part"
  mv -- "$gradle_archive.part" "$gradle_archive"
fi
if ! verify_gradle_archive; then
  rm -f -- "$gradle_archive"
  echo 'Gradle download failed official SHA-256 verification.' >&2
  exit 1
fi
# Extract only after checking the archive, including when restored from the cache.
rm -rf -- "$gradle_home"
unzip -q "$gradle_archive" -d "$toolchain_dir"
if [[ ! -x "$gradle_home/bin/gradle" ]]; then
  echo 'The verified Gradle distribution did not contain its executable.' >&2
  exit 1
fi

export ANDROID_SDK_ROOT="$sdk_root" ANDROID_HOME="$sdk_root"
export GRADLE_EXECUTABLE="$gradle_home/bin/gradle"
export ANDROID_KEYSTORE_PATH="$CM_KEYSTORE_PATH"
export ANDROID_KEYSTORE_PASSWORD="$CM_KEYSTORE_PASSWORD"
export ANDROID_KEY_ALIAS="$CM_KEY_ALIAS"
export ANDROID_KEY_PASSWORD="$CM_KEY_PASSWORD"

# Write values directly to Codemagic's private environment file, never to logs.
# Use its documented multiline form if a value contains newlines.
python3 - "$task_root/android/local.properties" <<'PY'
import os
from pathlib import Path
import sys
from uuid import uuid4

names = (
    'ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD',
    'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD',
    'ANDROID_SDK_ROOT', 'ANDROID_HOME', 'GRADLE_EXECUTABLE',
    'ANDROID_VERSION_CODE',
)
environment_file = Path(os.environ['CM_ENV'])
with environment_file.open('a', encoding='utf-8') as output:
    for name in names:
        value = os.environ[name]
        if '\n' in value or '\r' in value:
            marker = 'CM_VALUE_' + uuid4().hex
            output.write(f'{name}<<{marker}\n{value}\n{marker}\n')
        else:
            output.write(f'{name}={value}\n')
environment_file.chmod(0o600)
sdk = os.environ['ANDROID_SDK_ROOT'].replace('\\', '\\\\').replace(':', '\\:').replace(' ', '\\ ')
Path(sys.argv[1]).write_text(f'sdk.dir={sdk}\n', encoding='utf-8')
PY
"$GRADLE_EXECUTABLE" --version
echo 'Codemagic Android tools are ready; existing owner upload signing is configured.'
