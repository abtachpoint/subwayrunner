"""CI safety checks. Synthetic signed ZIP fixtures are not Android build outputs.

Temporary fixture keys are never used to sign the game and are deleted on exit.
No owner signing credentials, network service, or SDK is used by these tests.
"""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('verify_bundle', ROOT / 'tools/verify_aab.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class BundleVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which('java') or not shutil.which('keytool'):
            raise unittest.SkipTest('JDK tools are required for cryptographic fixture tests')
        cls.directory = tempfile.TemporaryDirectory(prefix='synthetic-aab-verifier-')
        cls.folder = Path(cls.directory.name)
        cls.key = cls.folder / 'fixture-only.jks'
        cls.env = dict(os.environ, AAB_FIXTURE_PASSWORD='synthetic-fixture-only')
        cls.run_tool(['keytool', '-genkeypair', '-alias', 'fixture', '-keyalg', 'RSA', '-keysize', '2048',
                      '-keystore', str(cls.key), '-storepass:env', 'AAB_FIXTURE_PASSWORD',
                      '-keypass:env', 'AAB_FIXTURE_PASSWORD', '-validity', '2',
                      '-dname', 'CN=Synthetic verifier fixture', '-noprompt'])
        cls.signed = cls.folder / 'signed-fixture.aab'
        cls.make_fixture(cls.signed)
        cls.run_tool(['java', '--module', 'jdk.jartool/sun.security.tools.jarsigner.Main',
                      '-keystore', str(cls.key), '-storepass:env', 'AAB_FIXTURE_PASSWORD',
                      '-keypass:env', 'AAB_FIXTURE_PASSWORD', str(cls.signed), 'fixture'])

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    @classmethod
    def run_tool(cls, command):
        result = subprocess.run(command, env=cls.env, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise AssertionError('Local JDK fixture preparation failed: ' + result.stderr)

    @staticmethod
    def make_fixture(path):
        # These bytes deliberately do not represent a compiled Android bundle;
        # only ZIP structure/signature handling is under test.
        names = ['BundleConfig.pb', 'base/manifest/AndroidManifest.xml', 'base/dex/classes.dex',
                 'base/assets/index.html', 'base/assets/app.js', 'base/assets/platform.js',
                 'base/assets/simulation.js', 'base/assets/renderer.js', 'base/assets/assets/models.js']
        with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
            for name in names:
                archive.writestr(name, 'synthetic verification fixture: ' + name)

    def test_unsigned_fixture_is_rejected_even_when_jarsigner_exit_status_is_zero(self):
        path = self.folder / 'unsigned-fixture.aab'
        self.make_fixture(path)
        with self.assertRaisesRegex(ValueError, 'signature verification failed'):
            bundle.verify(path)

    def test_all_payload_entries_must_be_cryptographically_signed(self):
        with patch.dict(os.environ, {'EXPECTED_UPLOAD_CERT_SHA256': ''}):
            result = bundle.verify(self.signed)
        self.assertTrue(result['signed'])
        self.assertEqual(len(result['upload_certificate_sha256']), 64)

    def test_payload_tampering_fails_jdk_signature_verification(self):
        target = self.folder / 'tampered-fixture.aab'
        with ZipFile(self.signed) as source, ZipFile(target, 'w', ZIP_DEFLATED) as output:
            for name in source.namelist():
                value = source.read(name)
                output.writestr(name, value + b'changed' if name == 'base/assets/app.js' else value)
        with self.assertRaisesRegex(ValueError, 'signature verification failed'):
            bundle.verify(target)

    def test_wrong_authorized_upload_fingerprint_is_rejected(self):
        with patch.dict(os.environ, {'EXPECTED_UPLOAD_CERT_SHA256': '0' * 64}):
            with self.assertRaisesRegex(ValueError, 'authorized upload certificate'):
                bundle.verify(self.signed)

    def test_signer_matches_the_configured_private_upload_keystore(self):
        # Read only the generated test fixture certificate, never a CI owner key.
        with patch.dict(os.environ, {'EXPECTED_UPLOAD_CERT_SHA256': '',
                                     'ANDROID_KEYSTORE_PATH': str(self.key),
                                     'ANDROID_KEYSTORE_PASSWORD': self.env['AAB_FIXTURE_PASSWORD'],
                                     'ANDROID_KEY_ALIAS': 'fixture'}):
            result = bundle.verify(self.signed, check_configured_keystore=True)
        self.assertTrue(result['configured_upload_keystore_match'])

    def test_renamed_or_incomplete_zip_is_not_a_bundle(self):
        path = self.folder / 'incomplete-fixture.aab'
        with ZipFile(path, 'w') as archive:
            archive.writestr('AndroidManifest.xml', 'not a bundle')
        with self.assertRaisesRegex(ValueError, 'Incomplete Android application bundle'):
            bundle.verify(path)


class WorkflowConfiguration(unittest.TestCase):
    def test_owner_verified_games_resource_and_manifest_are_connected(self):
        properties = (ROOT / 'android/gradle.properties').read_text()
        gradle = (ROOT / 'android/app/build.gradle.kts').read_text()
        manifest = (ROOT / 'android/app/src/main/AndroidManifest.xml').read_text()
        self.assertIn('playGamesAppId=613238310945', properties)
        self.assertIn('resValue("string", "play_games_app_id", gamesId.get())', gradle)
        self.assertIn('android:value="@string/play_games_app_id"', manifest)
        self.assertIn('buildToolsVersion = "36.0.0"', gradle)

    def test_codemagic_requires_managed_signing_and_real_gradle_output(self):
        workflow = (ROOT / 'codemagic.yaml').read_text()
        build = (ROOT / 'tools/build_android.sh').read_text()
        self.assertIn('subway_runner_upload', workflow)
        self.assertIn('--require-signing --ads-mode live', workflow)
        self.assertIn(':app:bundleRelease', build)
        self.assertIn('verify_aab.py', build)
        self.assertNotIn('wrangler deploy', workflow)
        self.assertNotIn('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', workflow)

    def test_setup_rejects_missing_managed_key_without_starting_downloads(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {key: value for key, value in os.environ.items() if not key.startswith('CM_KEY')}
            env.update(CM_BUILD_DIR=str(ROOT), CM_ENV=str(Path(folder) / 'environment'))
            result = subprocess.run(['bash', str(ROOT / 'tools/codemagic_setup.sh')], env=env,
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('CM_KEYSTORE_PATH', result.stderr)
            self.assertNotIn('Downloading', result.stdout)


if __name__ == '__main__':
    unittest.main()
