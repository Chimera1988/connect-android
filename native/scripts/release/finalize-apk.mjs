import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {nativeBaseline} from './config.mjs';
const report=JSON.parse(readFileSync('verification/parity/apk/APK-VERIFICATION.json','utf8'));
const baseline={...nativeBaseline(),apkSha256:report.sha256};
if(baseline.certificateSha256!==report.signerSha256.toLowerCase())throw Error('Final certificate mismatch');
writeFileSync('verification/parity/apk/CONNECT-NATIVE-BASELINE.json',JSON.stringify(baseline,null,2)+'\n');
copyFileSync('PWA_ANDROID_FINAL_PARITY_REPORT.md','verification/parity/apk/PWA_ANDROID_FINAL_PARITY_REPORT.md');
