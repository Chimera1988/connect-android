/** Connect inbox summaries with realtime updates and a polling safety net.
 * Server conversation_user_state is the cross-device read authority.
 */
import {useEffect,useMemo,useState} from 'react';
import {AppState} from 'react-native';
import {db,MESSAGE_COLUMNS,type Conversation,type Message} from './backend';

export type InboxSummary={last:Message|null;unread:number};
const GROUP_SIZE=35;
const MESSAGES_PER_GROUP=700;
export function useConnectNativeInbox(ownerId:string,conversations:Conversation[]):Record<string,InboxSummary>{
  const [summaries,setSummaries]=useState<Record<string,InboxSummary>>({});
  const keys=useMemo(()=>conversations.map(c=>c.id).slice(0,210).join(','),[conversations]);
  useEffect(()=>{
    if(!ownerId||!keys){setSummaries({});return;}
    let alive=true,fetching=false,queued=false;
    let debounce:ReturnType<typeof setTimeout>|null=null;
    const ids=keys.split(',').filter(Boolean);
    const groups:string[][]=[];
    for(let i=0;i<ids.length;i+=GROUP_SIZE)groups.push(ids.slice(i,i+GROUP_SIZE));
    const refresh=async()=>{
      if(fetching){queued=true;return;}
      fetching=true;
      try{
        const batches=await Promise.all(groups.map(async group=>{
          const [messages,reads]=await Promise.all([
            db.from('messages').select(MESSAGE_COLUMNS).in('conversation_id',group)
              .order('created_at',{ascending:false}).limit(MESSAGES_PER_GROUP),
            db.from('conversation_user_state').select('conversation_id,last_read_at')
              .eq('user_id',ownerId).in('conversation_id',group),
          ]);
          if(messages.error)throw messages.error;
          if(reads.error)throw reads.error;
          return {messages:(messages.data||[]) as Message[],
            reads:(reads.data||[]) as {conversation_id:string;last_read_at:string|null}[]};
        }));
        if(!alive)return;
        const latest:Record<string,InboxSummary>={};
        const readTimes:Record<string,string>={};
        ids.forEach(id=>{latest[id]={last:null,unread:0};});
        for(const batch of batches){
          for(const read of batch.reads)if(read.last_read_at)readTimes[read.conversation_id]=read.last_read_at;
          for(const message of batch.messages){
            const entry=latest[message.conversation_id];
            if(!entry)continue;
            if(!entry.last||message.created_at>entry.last.created_at)entry.last=message;
          }
        }
        for(const batch of batches)for(const message of batch.messages){
          const entry=latest[message.conversation_id];
          if(!entry||message.deleted_at||message.sender_id===ownerId)continue;
          if(message.created_at>(readTimes[message.conversation_id]||''))entry.unread++;
        }
        setSummaries(latest);
      }catch(e){console.warn('Connect inbox summaries:',e);}
      finally{
        fetching=false;
        if(queued&&alive){queued=false;void refresh();}
      }
    };
    const schedule=()=>{
      if(!alive||AppState.currentState!=='active'||debounce!==null)return;
      debounce=setTimeout(()=>{debounce=null;void refresh();},220);
    };
    void refresh();
    const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},11000);
    const resume=AppState.addEventListener('change',value=>{if(value==='active')schedule();});
    // Realtime improves latency; periodic fetch still works if the server's
    // publication does not expose a table or the websocket is disconnected.
    const channel=db.channel('connect-native-inbox-read-'+ownerId)
      .on('postgres_changes',{event:'*',schema:'public',table:'conversation_user_state',filter:'user_id=eq.'+ownerId},schedule)
      .subscribe();
    // One scoped subscription per batch. Never subscribe to every user's messages.
    const messageChannels=groups.map((group,index)=>db.channel(`connect-native-inbox-msg-${ownerId}-${index}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'messages',filter:`conversation_id=in.(${group.join(',')})`},schedule)
      .subscribe());
    return()=>{
      alive=false;clearInterval(timer);resume.remove();if(debounce!==null)clearTimeout(debounce);
      void db.removeChannel(channel);
      messageChannels.forEach(ch=>{void db.removeChannel(ch);});
    };
  },[keys,ownerId]);
  return summaries;
}
