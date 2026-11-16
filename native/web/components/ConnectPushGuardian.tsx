'use client';
/** CONNECT_PWA_PUSH_GUARDIAN_20261114 - mounted for every signed-in PWA page. */
import {useEffect} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {reconcileWebPush} from '../lib/connect-push-repair';

export default function ConnectPushGuardian({supabase,userId}:{supabase:SupabaseClient;userId:string}){
  useEffect(()=>{
    if(typeof window==='undefined'||window.ConnectAndroid||!('serviceWorker'in navigator))return;
    let live=true,attempt=0,lastStart=0,running=false;
    let retryTimer:ReturnType<typeof setTimeout>|null=null;
    const cancelRetry=()=>{if(retryTimer!==null){clearTimeout(retryTimer);retryTimer=null;}};
    const check=(force=false)=>{
      if(!live||running||document.visibilityState!=='visible'||navigator.onLine===false)return;
      if(!force&&Date.now()-lastStart<12000)return;
      cancelRetry();lastStart=Date.now();running=true;
      void reconcileWebPush(supabase,userId).then(result=>{
        if(!live)return;
        if(result.state==='temporary'){
          attempt=Math.min(attempt+1,4);
          retryTimer=setTimeout(()=>check(true),[15000,30000,60000,120000][attempt-1]);
        }else attempt=0;
      }).catch(()=>{
        if(!live)return;
        retryTimer=setTimeout(()=>check(true),30000);
      }).finally(()=>{running=false;});
    };
    const onFocus=()=>check();
    const onVisible=()=>{if(document.visibilityState==='visible')check();};
    const onOnline=()=>check(true);
    const onControllerChange=()=>check(true);
    window.addEventListener('focus',onFocus);
    window.addEventListener('online',onOnline);
    document.addEventListener('visibilitychange',onVisible);
    navigator.serviceWorker.addEventListener('controllerchange',onControllerChange);
    const periodic=setInterval(()=>check(),15*60*1000);
    check(true);
    return()=>{live=false;cancelRetry();clearInterval(periodic);window.removeEventListener('focus',onFocus);
      window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);
      navigator.serviceWorker.removeEventListener('controllerchange',onControllerChange);};
  },[supabase,userId]);
  return null;
}
