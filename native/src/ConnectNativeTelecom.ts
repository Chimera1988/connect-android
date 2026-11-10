/** Compatibility entrypoints: Kotlin owns Telecom, signals, WebRTC and teardown. */
import {db} from './backend';
import {NativeModules} from 'react-native';
const calls=NativeModules.ConnectCallCoordinator;
export function installTelecomEventHandlers(){}
export async function showIncomingSystemCall(id:string,_name:string,_chat:string|null){await db.auth.getSession();await calls.incoming(id);}
export async function showOutgoingSystemCall(_id:string,_name:string){}
export async function answerSystemCall(id:string){await calls.control(id,'answer');}
export async function activeSystemCall(_id:string){}
// A push end is a hint; native reconciliation reads the authoritative server row.
export async function endSystemCall(id:string){await calls.control(id,'sync');}
export function subscribeSystemTelecom(_listener:(action:'answer'|'end'|'mute'|'unmute',callId:string)=>void){return()=>{};}
export async function handleCallNotificationAction(action:string|undefined,data:Record<string,unknown>|undefined){
 if(typeof data?.callId!=='string')return;
 await calls.control(data.callId,action==='connect-answer'?'answer':action==='connect-decline'?'decline':'sync');
}
