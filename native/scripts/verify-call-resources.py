#!/usr/bin/env python3
"""Inspect final APK wiring and pixels after AAPT has renamed/re-encoded assets."""
import hashlib, io, json, os, re, subprocess, sys, zipfile
from pathlib import Path
from PIL import Image

apk, out = Path(sys.argv[1]), Path(sys.argv[2])
aapt = Path(os.environ['ANDROID_SDK_ROOT']) / 'build-tools/37.0.0/aapt'
manifest = subprocess.check_output([str(aapt), 'dump', 'xmltree', str(apk), 'AndroidManifest.xml'], text=True)
resources = subprocess.check_output([str(aapt), 'dump', '--values', 'resources', str(apk)], text=True)
root = Path(__file__).resolve().parents[1]
report = {}
with zipfile.ZipFile(apk) as z:
    dex = b''.join(z.read(n) for n in z.namelist() if re.fullmatch(r'classes\d*\.dex', n))
    classes = ['ConnectIncomingCallActivity', 'ConnectCallService', 'ConnectCallState', 'ConnectCallAudio',
               'ConnectCallConnectionService', 'ConnectCallCoordinatorModule', 'ConnectCallSession',
               'ConnectCallPushReceiver', 'ConnectPushTokenService', 'ConnectPushTokenJob']
    report['nativeClasses'] = {name: ('Lcom/connect/messenger/' + name + ';').encode() in dex for name in classes}
    assert all(report['nativeClasses'].values()), report['nativeClasses']
    assert b'Lcom/connect/messenger/ConnectCallGuardService;' not in dex
    for obsolete in ['io.wazo.callkeep.VoiceConnectionService', 'com.connect.messenger.ConnectCallGuardService',
                     'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver',
                     'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService']:
        assert obsolete not in manifest, obsolete
    assert manifest.count('="android.telecom.ConnectionService" (Raw:') == 1
    assert 'android:windowSoftInputMode' in manifest and '(type 0x11)0x10' in manifest
    for permission in ['VIBRATE', 'MANAGE_OWN_CALLS', 'FOREGROUND_SERVICE_PHONE_CALL', 'FOREGROUND_SERVICE_MICROPHONE', 'RECORD_AUDIO']:
        assert 'android.permission.' + permission in manifest, permission
    report['singleTelecomAndNativePushOwner'] = True
    report['mainActivityAdjustResize'] = True
    report['iconPixels'] = []
    config = None
    lines = resources.splitlines()
    for i, line in enumerate(lines):
        match = re.search(r'config (.*):$', line)
        if match: config = match[1]
        match = re.search(r'^\s+resource \S+ com.connect.messenger:(drawable|mipmap)/(ic_launcher(?:_round|_foreground|_background|_monochrome)?):', line)
        if not match: continue
        file = re.search(r'"(res/[^\"]+)"', lines[i + 1])[1]
        if file.endswith('.png'):
            folder = 'drawable-nodpi' if match[1] == 'drawable' else 'mipmap-' + config
            original = root / 'plugins/launcher-icons' / folder / (match[2] + '.png')
            expected = Image.open(original).convert('RGBA')
            actual = Image.open(io.BytesIO(z.read(file))).convert('RGBA')
            # AAPT legally clears hidden RGB values of fully transparent pixels.
            # All alpha values and all visible colour values must stay exact.
            def visible_rgba(im):
                return bytes(v for pixel in im.getdata() for v in (pixel if pixel[3] else (0, 0, 0, 0)))
            assert actual.size == expected.size and visible_rgba(actual) == visible_rgba(expected), str(original)
            report['iconPixels'].append({'resource': folder + '/' + original.name, 'size': list(actual.size), 'identicalVisibleRGBA': True})
        else:
            xml = subprocess.check_output([str(aapt), 'dump', 'xmltree', str(apk), file], text=True)
            assert 'adaptive-icon' in xml and 'foreground' in xml and 'background' in xml and 'monochrome' in xml
    assert len(report['iconPixels']) == 13, len(report['iconPixels'])
    report['abis'] = sorted({n.split('/')[1] for n in z.namelist() if n.startswith('lib/') and n.endswith('.so')})
    assert report['abis'] == ['arm64-v8a', 'armeabi-v7a']
    bundle = z.read('assets/index.android.bundle')
    assert bundle[:4] != b'var ' and len(bundle) > 100000  # actual embedded Hermes bundle
    report['embeddedPrivateKeyPatterns'] = sum(bundle.count(p.encode()) + bundle.count(p.encode('utf-16le')) for p in ['-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----', 'sb_secret_'])
    assert report['embeddedPrivateKeyPatterns'] == 0
    assert not any(n.lower().endswith(('.jks', '.keystore', '.p12', '.pem')) for n in z.namelist())
    provenance = json.loads(z.read('assets/connect-web/connect-crypto/PROVENANCE.json'))
    report['cryptoResourcesIntegrity'] = all(hashlib.sha256(z.read('assets/connect-web/connect-crypto/' + name)).hexdigest() == digest for name, digest in provenance['filesSha256'].items())
    assert report['cryptoResourcesIntegrity']
out.mkdir(parents=True, exist_ok=True)
(out / 'RESOURCE-VERIFICATION.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
