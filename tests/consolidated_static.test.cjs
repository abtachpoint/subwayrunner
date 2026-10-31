'use strict';

// Structural integration and preservation checks. These do not compile Kotlin,
// exercise Google SDKs, or establish an operational deployed backend.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const files = directory => fs.readdirSync(path.join(root, directory), {withFileTypes:true})
  .flatMap(entry => entry.isDirectory() ? files(directory + '/' + entry.name) : [directory + '/' + entry.name]);

test('original baked character/city geometry is preserved; final gameplay upgrades are present', () => {
  const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'web/assets/models.js'))).digest('hex');
  assert.equal(digest,'dcb2cfcb78fa73ead95bc00e1470ea9eb99cd931f38b5a500fa6e72f3b679ef8');
  assert.match(read('web/simulation.js'), /runner_style/);
  assert.match(read('web/simulation.js'), /car_role = 'coach'/);
  assert.match(read('web/renderer.js'), /NEON NIGHT/);
  assert.ok(fs.existsSync(path.join(root,'web/assets/fox.js')));
});

test('standard Android app hosts existing WebGL assets with the final identity', () => {
  const settings = read('android/settings.gradle.kts');
  assert.match(settings, /include\(":app"\)/);
  assert.doesNotMatch(settings, /include\(":services"\)/);
  const gradle = read('android/app/build.gradle.kts');
  assert.match(gradle, /applicationId\s*=\s*"com\.subwayrunner\.bd"/);
  assert.match(gradle, /assets\.srcDir\("\.\.\/\.\.\/web"\)/);
  assert.match(gradle, /targetSdk\s*=\s*36/);
  assert.match(gradle, /com\.google\.gms\.google-services/);
  for (const sdk of ['firebase-auth','play-services-games-v2','com.android.billingclient:billing','play-services-ads','user-messaging-platform']) {
    assert.ok(gradle.includes(sdk), sdk);
  }
  assert.ok(!/playGamesAppId[^\n]*613238310945/.test(gradle), 'Cloud project number must not be guessed as the PGS game ID');
  assert.match(gradle, /PLAY_GAMES_APP_ID/);
  assert.match(gradle, /ANDROID_KEYSTORE_PATH/);
  assert.ok(!gradle.includes('LOCAL-TEST'), 'Local prototype key is not an authorized Play release signing configuration');
});

test('provided Firebase Android configuration is matched without guessing OAuth resources', () => {
  const config = JSON.parse(read('android/app/google-services.json'));
  assert.equal(config.project_info.project_id, 'subway-runner-513217');
  assert.equal(config.project_info.project_number, '613238310945');
  const matching = config.client.find(c=>c.client_info.android_client_info.package_name==='com.subwayrunner.bd');
  assert.ok(matching);
  assert.equal(matching.client_info.mobilesdk_app_id, '1:613238310945:android:a6a750a7838becef4bbb60');
});

test('active Android application has no automatic or non-rewarded ad implementation', () => {
  const native = files('android/app/src').filter(f=>f.endsWith('.kt')).map(read).join('\n');
  assert.ok(native.length>100, 'Native application implementation is present');
  assert.doesNotMatch(native, /import\s+com\.google\.android\.gms\.ads\.(?:interstitial|appopen|AdView)/);
  assert.doesNotMatch(native, /\b(?:InterstitialAd|AppOpenAd|AdView)\.(?:load|show)/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(manifest, /MobileAdsInitProvider[\s\S]*?tools:node="remove"/);
  assert.match(manifest, /allowBackup="false"/);
});

test('production web client contains no successful local demo-ad or paid-diamond grant path', () => {
  const app = read('web/app.js');
  assert.doesNotMatch(app, /function\s+showDemoAd\s*\(/);
  assert.doesNotMatch(app, /COMPLETE DEMO|NO ADVERTISER · NO CHARGE/);
  assert.doesNotMatch(app, /wallet\s*:\s*99999/);
  const scripts = files('web').filter(f=>f.endsWith('.js')&&!f.includes('/assets/')).map(read).join('\n');
  assert.doesNotMatch(scripts, /\.diamonds\s*(?:\+=|-=|\+\+|--)/, 'Diamond balance must be replaced from server state, never locally minted/spent');
  assert.ok(scripts.includes('subway-native') || scripts.includes('SubwayNative'));
  assert.ok(scripts.includes('open_privacy'));
  assert.ok(scripts.includes('delete_account'));
});

test('backend deployment targets the provided worker/project and denies direct Firestore clients', () => {
  const config = read('worker/wrangler.jsonc');
  assert.ok(config.includes('subway-runner-api'));
  assert.ok(config.includes('subway-runner-513217'));
  assert.ok(config.includes('com.subwayrunner.bd'));
  const rules = read('worker/firestore.rules');
  assert.match(rules, /allow\s+read\s*,\s*write\s*:\s*if\s+false/);
  assert.ok(fs.existsSync(path.join(root,'worker/security.js')));
  assert.ok(fs.existsSync(path.join(root,'worker/economy.js')));
});

test('no private key material is embedded in active app, web assets or Worker source/config', () => {
  const names = [...files('android/app'), ...files('web'), ...files('worker')]
    .filter(name=>/\.(?:kt|js|mjs|json|jsonc|xml|kts|rules)$/.test(name)&&!name.includes('/node_modules/'));
  for (const name of names) {
    const source = read(name);
    assert.ok(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{40}/.test(source), 'Embedded private key: '+name);
  }
});
