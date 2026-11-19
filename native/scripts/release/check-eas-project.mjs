import {readFileSync} from 'node:fs';
import {app,writeReport} from './config.mjs';
// EAS CLI 27.10.0 project:info has no --json flag. Parse only its pinned ID/fullName fields.
const text=readFileSync('verification/parity/eas-project.txt','utf8').replace(/\u001b\[[0-9;]*m/g,'');
const id=text.match(/^ID\s+([0-9a-f-]{36})\s*$/m)?.[1];
const fullName=text.match(/^fullName\s+(@[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+)\s*$/m)?.[1];
if(id!==app.extra.eas.projectId||!fullName)throw Error('Authenticated EAS project mismatch');
writeReport('eas-project.json',{id,fullName});
