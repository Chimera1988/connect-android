import {appendFileSync,readFileSync,existsSync} from 'node:fs';
const names=['workflow-size.json','CONNECT-NATIVE-BASELINE.json','export-verified.json','prebuild-verified.json','ota-compatibility.json','ota-publication.json','apk/APK-VERIFICATION.json'];
if(process.env.GITHUB_STEP_SUMMARY){
 appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\nConnect Android parity: see job conclusion and uploaded logs for pass/fail. Physical device scenarios: НЕ ПРОВЕРЕНО.\n');
 for(const name of names){const file='verification/parity/'+name;if(existsSync(file))appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n'+name+'\n```json\n'+readFileSync(file,'utf8')+'```\n');}
}
