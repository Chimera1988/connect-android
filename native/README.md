# Connect Android

Expo SDK 58 / React Native 0.88 hosts one WebView containing the shared Connect PWA React/CSS/SVG interface. Native services handle Android notifications, audio calls, recording, files and permissions. The app keeps `com.connect.messenger`, the existing Firebase client, Supabase accounts and the Connect HTTPS proxy. Calls are audio only; camera access is used for video notes and attachments.

## Development and verification

Node 24, Java 21, Android SDK platform 37.0/build-tools 37.0.0, NDK 27.1.12297006 and CMake 3.22.1 are used for the release. Minimum Android API is 29. Run from this directory:

```sh
npm ci
npm run build:web
npm run typecheck:web
npm run typecheck
npm test
npx expo prebuild --platform android --no-install --clean
cd android
./gradlew :app:compileReleaseKotlin :app:compileReleaseJavaWithJavac :app:testDebugUnitTest
./gradlew :app:assembleRelease
```

The generated `android/` directory is disposable; native changes belong in config plugins. The release embeds the JavaScript and PWA resources. Do not run the historical YAML source installers: they describe previous snapshots, may rewrite source and are unrelated to this build.

## One release artifact

[Connect — unified Android release](../.github/workflows/connect-release.yml) builds the selected branch and uploads artifact `Connect`, containing `Connect.apk`, its SHA-256, APK verification metadata and the current release report. It does not publish to a store or change the repository branch.

To use an existing release key, configure GitHub secrets `CONNECT_RELEASE_KEYSTORE_BASE64`, `CONNECT_RELEASE_STORE_PASSWORD`, `CONNECT_RELEASE_KEY_ALIAS` and `CONNECT_RELEASE_KEY_PASSWORD`. A local build accepts `CONNECT_RELEASE_KEYSTORE_FILE` plus the three password/alias variables. Never commit signing keys or passwords. Optional repository variable `CONNECT_PREVIOUS_CERT_SHA256` makes verification reject a mismatched certificate.

When no release key is supplied, the installable release variant uses the Expo Android debug key, and verification labels that fallback explicitly. The latest previous artifact, `Connect-Android-PreRelease` from run `42594774881` (9 November 2026), has certificate SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`, matching the Expo 58 template key. This is a comparison with that artifact, not proof of the certificate installed on a particular phone or a production signing arrangement. Installation over an application with a different certificate requires a data-preserving migration plan.

After copying the generated release APK to `../release/Connect.apk`, verify it using:

```sh
python3 scripts/verify-apk.py ../release/Connect.apk ../release
```

Compilation and source tests do not establish FCM delivery, locked-screen calls, Bluetooth routing, microphone/camera codecs, frame rate, or screenshot parity. Record the actual tested device/API and scenario results in `FINAL_RELEASE_REPORT.md`; retain untested cases explicitly.
