/** Reconcile Android message notifications with authoritative server read state.
 * Runs only for the authenticated user's visible notifications when foregrounded.
 * Avoids dismissing alerts for newer messages; on reconnect it heals missing
 * FCM read receipts from PWA/other Android devices.
 */
import {useEffect} from 'react';
import {AppState} from 'react-native';
import notifee from '@notifee/react-native';
import {db} from './backend';
import {dismissChatPush,rememberReadAt} from './ConnectNativePush';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function useConnectNativeReadSync(ownerId:string){
  useEffect(()=>{
    if(!ownerId)return;
    let alive=true,fetching=false;
    const reconcile=async()=>{
      if(!alive||fetching||AppState.currentState!=='active')return;
      fetching=true;
      try{
        const alerts=await notifee.getDisplayedNotifications();
        if(!alive)return;
        const chats=alerts.filter(x=>x.notification?.data?.kind==='message')
          .map(x=>({conversationId:String(x.notification?.data?.conversationId||''),
            createdAt:String(x.notification?.data?.createdAt||'')}))
          .filter(x=>UUID.test(x.conversationId));
        if(!chats.length)return;
        const ids=Array.from(new Set(chats.map(x=>x.conversationId)));
        const result=await db.from('conversation_user_state')
          .select('conversation_id,last_read_at').eq('user_id',ownerId).in('conversation_id',ids);
        if(!alive||result.error)return;
        const reads=new Map((result.data||[]).map(row=>[String(row.conversation_id),String(row.last_read_at||'')]));
        for(const alert of chats){
          const read=reads.get(alert.conversationId)||'';
          if(!read||!Number.isFinite(Date.parse(read)))continue;
          // Missing FCM sent-at time: do not assume this alert was read.
          if(!alert.createdAt||!Number.isFinite(Date.parse(alert.createdAt)))continue;
          if(Date.parse(read)>=Date.parse(alert.createdAt)){
            await rememberReadAt(alert.conversationId,read);
            if(alive)await dismissChatPush(alert.conversationId,read);
          }
        }
      }catch(e){console.warn('Connect notification read reconciliation:',e);}
      finally{fetching=false;}
    };
    void reconcile();
    const interval=setInterval(()=>{void reconcile();},35000);
    const state=AppState.addEventListener('change',v=>{if(v==='active')void reconcile();});
    const channel=db.channel('connect-native-cross-device-reads-'+ownerId)
      .on('postgres_changes',{event:'*',schema:'public',table:'conversation_user_state',filter:'user_id=eq.'+ownerId},()=>{void reconcile();})
      .subscribe();
    return()=>{alive=false;clearInterval(interval);state.remove();void db.removeChannel(channel);};
  },[ownerId]);
}
