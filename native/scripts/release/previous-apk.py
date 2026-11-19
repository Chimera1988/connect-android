"""Compare a real previous APK using Android tools, not historical reports."""
import os,re,subprocess,json,hashlib,sys
from pathlib import Path
sdk=Path(os.environ['ANDROID_HOME'])/'build-tools/37.0.0'
apk=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
text=subprocess.check_output([str(sdk/'aapt'),'dump','badging',str(apk)],text=True)
match=re.search(r"package: name='com.connect.messenger' versionCode='(\d+)' versionName='([^']+)'",text)
if not match:raise SystemExit('Previous APK identity invalid')
cert=subprocess.check_output([str(sdk/'apksigner'),'verify','--verbose','--print-certs',str(apk)],text=True)
# This script is executed as scripts/release/previous-apk.py from native/.
# Its import path otherwise excludes the parent scripts directory.
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from check_release_signing import read_apksigner_fingerprint
expected='a6507c8b798b77774144502fb1d9a6d09c53da98946b174c692175a96c230130'
try:
 actual=read_apksigner_fingerprint(cert)
except ValueError as error:
 raise SystemExit('Cannot verify previous APK signer: '+str(error)) from error
if actual!=expected:raise SystemExit('Previous APK production certificate mismatch; release stopped')
app=json.loads(Path('app.json').read_text())['expo']
resources=subprocess.check_output([str(sdk/'aapt2'),'dump','resources',str(apk)],text=True)
runtimes=set(re.findall(r'connect-android-ota-v[0-9]+-sdk58',resources))
if len(runtimes)!=1:raise SystemExit('Cannot establish previous installed Expo runtime')
previous_runtime=runtimes.pop()
previous_baseline=apk.parent/'CONNECT-NATIVE-BASELINE.json'
if previous_runtime==app['runtimeVersion']:
 if not previous_baseline.is_file():raise SystemExit('Same-runtime APK requires previous native baseline; otherwise use a reviewed new runtime')
 baseline=json.loads(previous_baseline.read_text())
 current=json.loads(Path('verification/parity/CONNECT-NATIVE-BASELINE.json').read_text())
 if baseline.get('apkSha256')!=hashlib.sha256(apk.read_bytes()).hexdigest() or baseline.get('nativeSha256')!=current['nativeSha256']:
  raise SystemExit('Native changes require a new runtime in reviewed app.json before APK publication')
if app['android']['versionCode']<=int(match[1]):raise SystemExit('Increase versionCode in reviewed app.json before APK release')
(out/'previous-apk.json').write_text(json.dumps({'version':match[2],'versionCode':int(match[1]),'certificateSha256':expected,'apkSha256':hashlib.sha256(apk.read_bytes()).hexdigest()},indent=2)+'\n')
print('Previous production APK verified; new versionCode is strictly greater')
