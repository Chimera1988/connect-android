const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configureRelease } = require('../plugins/withConnectRelease');

test('release uses supplied signing key without persisting secrets and is idempotent', () => {
  const input = 'android {\n    buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n        }\n    }\n}';
  const result = configureRelease(input);
  assert.match(result, /signingConfig connectKeystore \? signingConfigs.connectRelease : signingConfigs.debug/);
  assert.match(result, /System.getenv\("CONNECT_RELEASE_KEY_PASSWORD"\)/);
  assert.equal(configureRelease(result), result);
  assert.throws(() => configureRelease('android {}'), /Cannot locate/);
});

test('release keeps production identity and Android 10 support', () => {
  const expo = JSON.parse(fs.readFileSync(path.join(__dirname, '../app.json'))).expo;
  assert.equal(expo.name, 'Connect');
  assert.equal(expo.android.package, 'com.connect.messenger');
  assert.equal(expo.android.versionCode, 16);
  assert.equal(expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-build-properties')[1].android.minSdkVersion, 29);
});
