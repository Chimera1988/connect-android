/** PWA-compatible presence lease: refresh while Android is foregrounded.
 * Uses the same profiles.online_until / last_seen_at contract as Connect PWA.
 * A killed process naturally goes offline when its 45-second lease expires.
 */
import {useEffect} from 'react';
import {AppState} from 'react-native';
import {db} from './backend';

export function useConnectNativePresence(userId:string){
  useEffect(()=>{
    if(!userId)return;
    let alive=true;
    let active=AppState.currentState==='active';
    let seq=0;
    const pulse=(online:boolean)=>{
      if(!alive)return;
      const now=new Date();
      void db.from('profiles').update({
        last_seen_at:now.toISOString(),
        online_until:new Date(now.getTime()+(online?45000:0)).toISOString(),
      }).eq('id',userId).then(({error})=>{
        if(error&&seq++<2)console.warn('Connect presence:',error.message);
      });
    };
    pulse(active);
    const sub=AppState.addEventListener('change',state=>{
      const next=state==='active';
      if(next===active)return;
      active=next;pulse(next);
    });
    const timer=setInterval(()=>{if(active)pulse(true);},15000);
    return()=>{
      if(active)pulse(false);
      alive=false;clearInterval(timer);sub.remove();
    };
  },[userId]);
}
