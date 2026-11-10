/** Reproducible release settings; signing material is supplied only at build time. */
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

function configureRelease(contents) {
  // Runtime release binaries do not require Play Console native debug archives.
  if (!contents.includes('// Connect omit packaged debug symbols') && /release\s*\{/.test(contents))
    contents = contents.replace(/release\s*\{/, "release {\n            // Connect omit packaged debug symbols\n            ndk { debugSymbolLevel 'none' }");
  if (contents.includes('// Connect release signing')) return contents;
  const anchor = '    buildTypes {';
  if (!contents.includes(anchor)) throw new Error('Cannot locate Android buildTypes');
  const signing = `    // Shipping binaries do not need intermediate native debug information.
    // This keeps source builds within smaller Android build workspaces.
    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_CXX_FLAGS_RELWITHDEBINFO=-O2 -DNDEBUG -g0", "-DCMAKE_C_FLAGS_RELWITHDEBINFO=-O2 -DNDEBUG -g0"
            }
        }
    }
    // Connect release signing: never embed passwords or a private key in source.
    def connectKeystore = System.getenv("CONNECT_RELEASE_KEYSTORE_FILE")
    if (connectKeystore) {
        for (name in ["CONNECT_RELEASE_STORE_PASSWORD", "CONNECT_RELEASE_KEY_ALIAS", "CONNECT_RELEASE_KEY_PASSWORD"]) {
            if (!System.getenv(name)) throw new GradleException("Missing release signing variable: " + name)
        }
        signingConfigs {
            connectRelease {
                storeFile file(connectKeystore)
                storePassword System.getenv("CONNECT_RELEASE_STORE_PASSWORD")
                keyAlias System.getenv("CONNECT_RELEASE_KEY_ALIAS")
                keyPassword System.getenv("CONNECT_RELEASE_KEY_PASSWORD")
            }
        }
    }
`;
  contents = contents.replace(anchor, signing + '\n' + anchor);
  const release = /(release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!release.test(contents)) throw new Error('Cannot locate Expo release signing configuration');
  return contents.replace(release, '$1signingConfig connectKeystore ? signingConfigs.connectRelease : signingConfigs.debug');
}

module.exports = function withConnectRelease(config) {
  config = withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('Connect requires Groovy app/build.gradle');
    mod.modResults.contents = configureRelease(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const res = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res');
    const drawable = path.join(res, 'drawable');
    fs.mkdirSync(drawable, { recursive: true });
    // Reuse the approved transparent mark, without the wordmark or rounded button.
    fs.copyFileSync(path.join(mod.modRequest.projectRoot, 'assets/connect-splash-bubbles.png'), path.join(drawable, 'connect_launcher_mark.png'));
    const foreground = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:width="52dp" android:height="39dp" android:gravity="center" android:drawable="@drawable/connect_launcher_mark" />
</layer-list>
`;
    fs.writeFileSync(path.join(drawable, 'connect_launcher_foreground.xml'), foreground);
    const adaptive = path.join(res, 'mipmap-anydpi-v26');
    fs.mkdirSync(adaptive, { recursive: true });
    for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
      fs.writeFileSync(path.join(adaptive, name), `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/iconBackground" />
  <foreground android:drawable="@drawable/connect_launcher_foreground" />
</adaptive-icon>
`);
    }
    return mod;
  }]);
};
module.exports.configureRelease = configureRelease;
