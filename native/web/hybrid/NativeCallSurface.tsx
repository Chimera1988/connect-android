import {useEffect} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
type Props={client:SupabaseClient|null;userId:string|null;conversationId:string|null;peerId:string|null;peerName:string};
export default function NativeCallSurface({userId,conversationId,peerId,peerName}:Props){
 useEffect(()=>{const dial=(event:Event)=>{const target=(event as CustomEvent).detail||{conversationId,peerId,peerName};if(userId&&target.conversationId&&target.peerId)void window.ConnectNative?.request('calls:dial',target).catch(error=>window.dispatchEvent(new CustomEvent('connect:native-error',{detail:error.message})));};window.addEventListener('connect:audio-call:start',dial);return()=>window.removeEventListener('connect:audio-call:start',dial);},[userId,conversationId,peerId,peerName]);
 return null;
}
