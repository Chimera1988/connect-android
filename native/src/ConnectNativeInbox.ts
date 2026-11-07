/** Connect Native: lightweight recent-message summaries for the chat list.
 * Read timestamps remain authoritative in conversation_user_state.
 * Batch queries avoid a separate request per conversation.
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
    let alive=true;
    let fetching=false;
    const ids=keys.split(',').filter(Boolean);
    const chunks:string[][]=[];
    for(let i=0;i<ids.length;i+=GROUP_SIZE)chunks.push(ids.slice(i,i+GROUP_SIZE));
    const refresh=async()=>{
      if(fetching)return;
      fetching=true;
      try{
        const results=await Promise.all(chunks.map(async group=>{
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
        for(const id of ids)latest[id]={last:null,unread:0};
        for(const batch of results){
          for(const read of batch.reads)if(read.last_read_at)readTimes[read.conversation_id]=read.last_read_at;
          for(const message of batch.messages){
            const entry=latest[message.conversation_id];
            if(!entry)continue;
            if(!entry.last||message.created_at>entry.last.created_at)entry.last=message;
          }
        }
        for(const batch of results)for(const message of batch.messages){
          const entry=latest[message.conversation_id];
          if(!entry||message.deleted_at||message.sender_id===ownerId)continue;
          if(message.created_at>(readTimes[message.conversation_id]||''))entry.unread++;
        }
        setSummaries(latest);
      }catch(e){console.warn('Connect inbox summaries:',e);}
      finally{fetching=false;}
    };
    void refresh();
    const timer=setInterval(()=>{if(AppState.currentState==='active')void refresh();},11000);
    return()=>{alive=false;clearInterval(timer);};
  },[keys,ownerId]);
  return summaries;
}
