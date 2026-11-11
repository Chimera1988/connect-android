import {isMissedIncomingCall as missed} from './call-missed';
/** Unseen missed-call badge compatible with PWA visibility rules. */
import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState,DeviceEventEmitter} from 'react-native';
import {nativeCallJournal} from './call-journal';
import * as SecureStore from 'expo-secure-store';
import {db,type Call} from './backend';

const SELECT='id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at';


export function useConnectNativeMissedCalls(userId:string,open:boolean){
  const [count,setCount]=useState(0);
  const [lastViewed,setLastViewed]=useState(0);
  const mounted=useRef(0);
  const lastViewedRef=useRef(0);
  const openRef=useRef(open);
  const rowsRef=useRef<Call[]>([]);
  const hiddenRef=useRef<string[]>([]);
  const cutoffRef=useRef<string|null>(null);
  openRef.current=open;
  const recompute=useCallback((rows:Call[],hidden:string[],cutoff:string|null,viewed:number)=>{
    if(!userId){setCount(0);return;}
    const n=rows.filter(row=>missed(row,userId)&&!hidden.includes(row.id)&&
      (!cutoff||Date.parse(row.created_at)>Date.parse(cutoff))&&
      Date.parse(row.ended_at||row.created_at)>viewed).length;
    setCount(openRef.current?0:n);
  },[userId]);
  const refresh=useCallback(async()=>{
    if(!userId)return;
    const generation=mounted.current;
    const [calls,prefs]=await Promise.all([
      db.from('connect_calls').select(SELECT).or(`caller_id.eq.${userId},callee_id.eq.${userId}`).order('created_at',{ascending:false}).limit(150),
      db.from('connect_call_journal_settings').select('cleared_before,hidden_ids').eq('owner_id',userId).maybeSingle(),
    ]);
    if(generation!==mounted.current||calls.error||prefs.error)return;
    rowsRef.current=(calls.data||[]) as Call[];
    hiddenRef.current=Array.isArray(prefs.data?.hidden_ids)?prefs.data.hidden_ids:[];
    cutoffRef.current=prefs.data?.cleared_before||null;
    recompute(rowsRef.current,hiddenRef.current,cutoffRef.current,lastViewedRef.current);
    const rows=rowsRef.current.map(row=>({...row,hidden:hiddenRef.current.includes(row.id)||!!(cutoffRef.current&&Date.parse(row.created_at)<=Date.parse(cutoffRef.current))}));
    try{const state=await nativeCallJournal(userId,'reconcile',{rows});if(generation===mounted.current){lastViewedRef.current=state.lastViewed;setLastViewed(state.lastViewed);setCount(openRef.current?0:state.count);}}catch{}

  },[userId,recompute]);
  useEffect(()=>{
    const generation=++mounted.current;
    setCount(0);setLastViewed(0);lastViewedRef.current=0;rowsRef.current=[];hiddenRef.current=[];cutoffRef.current=null;
    if(!userId)return;
    void SecureStore.getItemAsync('connect-native-last-viewed-calls-'+userId).then(async value=>{
      if(mounted.current!==generation)return;
      const parsed=Number(value||0);
      lastViewedRef.current=Number.isFinite(parsed)&&parsed>0?parsed:0;
      try{let state=await nativeCallJournal(userId,'state');if(lastViewedRef.current>state.lastViewed)state=await nativeCallJournal(userId,'seed',{at:lastViewedRef.current});if(mounted.current!==generation)return;lastViewedRef.current=state.lastViewed;setCount(state.count);}catch{}
      setLastViewed(lastViewedRef.current);
      void refresh();
    }).catch(()=>{if(mounted.current===generation)void refresh();});
    const missedListener=DeviceEventEmitter.addListener('connect:missed-changed',()=>void refresh());
    const timer=setInterval(()=>void refresh(),20000);
    const listener=AppState.addEventListener('change',state=>{if(state==='active')void refresh();});
    const channel=db.channel(`connect-native-missed-${userId}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'connect_calls',filter:`caller_id=eq.${userId}`},()=>{void refresh();})
      .on('postgres_changes',{event:'*',schema:'public',table:'connect_calls',filter:`callee_id=eq.${userId}`},()=>{void refresh();})
      .on('postgres_changes',{event:'*',schema:'public',table:'connect_call_journal_settings',filter:`owner_id=eq.${userId}`},()=>{void refresh();})
      .subscribe();
    return()=>{mounted.current++;missedListener.remove();clearInterval(timer);listener.remove();void db.removeChannel(channel);};
  },[userId,refresh]);
  const markViewed=useCallback(async()=>{
    if(!userId)return;
    const at=Date.now();lastViewedRef.current=at;setLastViewed(at);setCount(0);
    try{await nativeCallJournal(userId,'view');}catch{}
    try{await SecureStore.setItemAsync('connect-native-last-viewed-calls-'+userId,String(at));}catch{/* badge still resets in memory */}
  },[userId]);
  useEffect(()=>{if(open&&userId)void markViewed();return()=>{if(userId)void nativeCallJournal(userId,'close').catch(()=>{});};},[open,userId,markViewed]);
  return {count,lastViewed,markViewed};
}
