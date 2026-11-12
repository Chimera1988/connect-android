#!/usr/bin/env python3
"""Verify the delivered artifact, rather than accepting a successful Gradle exit."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import zipfile

apk = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2] if len(sys.argv) > 2 else apk.parent).resolve()
output.mkdir(parents=True, exist_ok=True)
sdk = Path(os.environ.get('ANDROID_SDK_ROOT', os.environ.get('ANDROID_HOME', '')))
tools = sdk / 'build-tools' / '37.0.0'
badging = subprocess.check_output([str(tools / 'aapt'), 'dump', 'badging', str(apk)], text=True)
assert "package: name='com.connect.messenger'" in badging, 'Wrong application ID'
assert "application-label:'Connect'" in badging, 'Wrong visible name'
assert "versionCode='22'" in badging and "versionName='3.0.4'" in badging, 'Wrong release version'
assert "sdkVersion:'29'" in badging, 'Android 10 minimum not enforced'
assert 'application-debuggable' not in badging, 'Release must not be debuggable'
with zipfile.ZipFile(apk) as z:
    assert z.testzip() is None, 'Corrupt APK'
    bundle = z.read('assets/index.android.bundle')
    assert len(bundle) > 100_000, 'Missing embedded JavaScript'
    for asset in ['connect-splash-bubbles-transparent.png', 'connect-scenes/moon.svg',
                  'connect-scenes/aurora.svg', 'connect-scenes/lagoon.svg']:
        assert 'assets/connect-web/' + asset in z.namelist(), 'Missing bundled PWA resource: ' + asset
    for asset in ['connect-crypto/olm.js','connect-crypto/olm.wasm']:
        assert 'assets/connect-web/' + asset in z.namelist(), 'Missing verified crypto primitive: '+asset
    stickers=[n for n in z.namelist() if n.startswith('assets/connect-web/stickers/') and n.endswith('.webp')]
    assert len(stickers)==96, 'All 96 optimized stickers must be bundled'
    assert not any(n.startswith('assets/connect-web/stickers/') and n.endswith('.svg') for n in z.namelist()), 'Legacy URLs must alias WebP, not duplicate SVG files'
    for name in stickers:
        source=Path(__file__).resolve().parents[1]/'web/public'/name.removeprefix('assets/connect-web/')
        assert hashlib.sha256(z.read(name)).digest()==hashlib.sha256(source.read_bytes()).digest(), name
    dex=b''.join(z.read(n) for n in z.namelist() if re.fullmatch(r'classes\d*\.dex',n))
    for name in ['ConnectCallService','ConnectCallConnectionService','ConnectIncomingCallActivity','ConnectCallSetupActivity','ConnectCallIngress','ConnectCallTiming','ConnectCallScreen','ConnectCallAudioGate','ConnectIncomingAlerts','ConnectIncomingGate','ConnectPushTokenService','ConnectCallHintJob','ConnectHistoryModule','HistoryStore','ConnectSoundModule','ConnectFilesModule','ConnectMissedCalls','ConnectMissedCallJob','ConnectMissedPolicy','ConnectProximityOwner','HistoryCatalogPolicy']:
        assert ('Lcom/connect/messenger/'+name+';').encode() in dex, 'Native implementation missing: '+name
    resource_table = subprocess.check_output([str(tools/'aapt2'), 'dump', 'resources', str(apk)],text=True)
    for index, name in enumerate(['bright','call','gentle','soft','firebase_common_keep','keep','node_modules_expo_vectoricons_build_vendor_reactnativevectoricons_fonts_ionicons','notification','ringtone']):
        resource_name=name if index in (4,5,6) else 'connect_'+name
        assert f'resource {0x7f110000+index:#010x} raw/{resource_name}' in resource_table, 'Numeric channel URI compatibility lost: '+name
    sounds = {
        'connect_ringtone.mp3': (481171, '974d3a6817676687c04fbce6568b238e31d8a30206fc0e5fe35cfbee9bf6025c'),
        'connect_notification.mp3': (28103, '8bf5b905ca973d7f38d84feaa4237d2246b10f5e186fb280f14781c05d70622e'),
    }
    for filename, (size, digest) in sounds.items():
        block = resource_table.split(' raw/'+filename.split('.')[0], 1)[1].split('    resource ', 1)[0]
        resource_path = re.search(r'\(file\) (\S+)', block)[1]
        audio = z.read(resource_path)
        assert len(audio) == size and hashlib.sha256(audio).hexdigest() == digest, 'Wrong MP3 in APK: '+filename
    for name in ['soft', 'bright', 'gentle', 'call']:
        block = resource_table.split(' raw/connect_'+name, 1)[1].split('    resource ', 1)[0]
        resource_path = re.search(r'\(file\) (\S+)', block)[1]
        source = Path(__file__).resolve().parents[1]/('assets/notification_sounds/connect_'+name+'.wav')
        assert hashlib.sha256(z.read(resource_path)).digest() == hashlib.sha256(source.read_bytes()).digest(), 'Legacy sound removed: '+name
    assert not any(n.lower().endswith(('.jks','.keystore','.p12','.pem')) for n in z.namelist()), 'Signing material must not be shipped'
    assert sorted({n.split('/')[1] for n in z.namelist() if n.startswith('lib/') and n.endswith('.so')})==['arm64-v8a','armeabi-v7a']
signature = subprocess.check_output([str(tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
fingerprint = re.search(r'(?:Signer #1|V2 Signer|V3 Signer):? certificate SHA-256 digest: ([0-9a-fA-F]+)', signature)
assert fingerprint, 'Missing signing certificate'
expected = os.environ.get('CONNECT_PREVIOUS_CERT_SHA256', '').replace(':', '').lower()
compatible = None if not expected else expected == fingerprint[1].lower()
previous_artifact_certificate = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'
if compatible is False:
    raise SystemExit('Certificate differs from configured previous release; refusing incompatible update artifact')
report = {
    'filename': 'Connect.apk', 'applicationId': 'com.connect.messenger',
    'version': '3.0.4', 'versionCode': 22, 'minSdk': 29,
    'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
    'signerSha256': fingerprint[1],
    'signing': 'supplied-release-key' if os.environ.get('CONNECT_RELEASE_KEYSTORE_FILE') else 'Android debug key (fallback)',
    'compatibleWithPreviousCertificate': compatible,
    'previousArtifactVersion': '3.0.1 (19)',
    'previousArtifactApkSha256': '89a20772daf9acbeaabd4a60b0aead6effd62df27c0a3baeb6f1013388a4b650',
    'matchesPreviousArtifactCertificate': fingerprint[1].lower() == previous_artifact_certificate,
    'embeddedJavaScript': True,
    'deviceAcceptance': 'Not established by APK verification. See SOUNDS_301_REPORT.md.',
}
(output / 'APK-VERIFICATION.json').write_text(json.dumps(report, indent=2) + '\n')
(output / 'APK-SIGNATURE.txt').write_text(signature)
(output / 'SHA256.txt').write_text(report['sha256'] + '  Connect.apk\n')
print(json.dumps(report, indent=2))
