#!/usr/bin/env python3
"""Verify a real AGP-produced AAB and its upload-key signature; never construct one."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from zipfile import ZipFile, BadZipFile


def verify(path: Path, require_signature: bool = True, check_configured_keystore: bool = False) -> dict:
    if path.suffix != '.aab' or not path.is_file():
        raise ValueError('Expected a real .aab output from the Android Gradle build')
    with ZipFile(path) as archive:
        names = archive.namelist()
        required = {'BundleConfig.pb', 'base/manifest/AndroidManifest.xml', 'base/dex/classes.dex',
                    'base/assets/index.html', 'base/assets/app.js', 'base/assets/platform.js',
                    'base/assets/simulation.js', 'base/assets/renderer.js', 'base/assets/assets/models.js'}
        missing = required - set(names)
        if missing:
            raise ValueError('Incomplete Android application bundle: ' + ', '.join(sorted(missing)))
        if 'AndroidManifest.xml' in names or len(names) != len(set(names)) or archive.testzip():
            raise ValueError('Invalid bundle ZIP structure or integrity')
        if any(name.startswith('/') or '..' in Path(name).parts for name in names):
            raise ValueError('Unsafe bundle entry path')
        if any(name.endswith(('.pem', '.keystore', '.jks', '/.env', '/.dev.vars')) for name in names):
            raise ValueError('Private signing/runtime material must not be bundled')
        if any(not archive.read(name) for name in required):
            raise ValueError('Required bundle payload is empty')
    result = {'artifact': str(path), 'bytes': path.stat().st_size,
              'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'signed': False}
    if require_signature:
        java = subprocess.run(['java', str(Path(__file__).with_name('VerifyBundle.java')), str(path)],
                              text=True, capture_output=True, timeout=120)
        if java.returncode:
            raise ValueError('Bundle signature verification failed: ' + (java.stderr or java.stdout).strip())
        match = re.search(r'^UPLOAD_CERTIFICATE_SHA256=([a-f0-9]{64})$', java.stdout, re.MULTILINE)
        if not match:
            raise ValueError('No authenticated bundle upload signer')
        signer = match.group(1)
        expected = os.environ.get('EXPECTED_UPLOAD_CERT_SHA256', '').replace(':', '').lower().strip()
        if expected and (not re.fullmatch(r'[a-f0-9]{64}', expected) or expected != signer):
            raise ValueError('Bundle signer does not match the configured authorized upload certificate')
        result.update(signed=True, upload_certificate_sha256=signer)
        if check_configured_keystore:
            key = os.environ.get('ANDROID_KEYSTORE_PATH', '')
            alias = os.environ.get('ANDROID_KEY_ALIAS', '')
            if not key or not alias or not os.environ.get('ANDROID_KEYSTORE_PASSWORD'):
                raise ValueError('Configured upload keystore is required to compare the bundle signer')
            public = subprocess.run(['keytool', '-exportcert', '-keystore', key, '-alias', alias,
                                     '-storepass:env', 'ANDROID_KEYSTORE_PASSWORD'],
                                    capture_output=True, timeout=30)
            if public.returncode or not public.stdout:
                raise ValueError('Could not read the configured upload certificate')
            if hashlib.sha256(public.stdout).hexdigest() != signer:
                raise ValueError('Bundle signer differs from the configured upload keystore')
            result['configured_upload_keystore_match'] = True
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--allow-unsigned', action='store_true')
    parser.add_argument('--report', type=Path)
    parser.add_argument('--check-configured-keystore', action='store_true')
    args = parser.parse_args()
    try:
        result = verify(args.bundle, not args.allow_unsigned, args.check_configured_keystore)
    except (ValueError, OSError, BadZipFile, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
    encoded = json.dumps(result, indent=2) + '\n'
    if args.report:
        args.report.write_text(encoded)
    print(encoded, end='')
