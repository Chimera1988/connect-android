'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {cacheStats,clearCachedMedia,cacheLimit,setCacheLimit,type CacheCategory} from '../lib/media-cache';
import {chatHistoryStats,wipeUserHistory,setNativeHistoryLimit,type NativeHistoryStats} from '../lib/chat-history-cache';
const names:Record<CacheCategory,string>={system:'Системные элементы и аватары',photos:'Фотографии и стикеры',videos:'Видео и видеокружки',audio:'Голосовые и аудиофайлы',other:'Прочие временные файлы'};
const size=(n:number)=>n<1024**2?(n/1024).toFixed(0)+' КБ':(n/1024**2).toFixed(1)+' МБ';
export default function CacheSettings({userId}:{userId:string}){
 const [stats,setStats]=useState<Record<CacheCategory,number>|null>(null),[history,setHistory]=useState<NativeHistoryStats|null>(null),[limit,setLimit]=useState('auto'),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
 const mounted=useRef(false),currentUser=useRef(userId);currentUser.current=userId;
 const refresh=useCallback(async()=>{const [media,local]=await Promise.all([cacheStats(),chatHistoryStats(userId)]);if(!mounted.current||currentUser.current!==userId)return;setStats({...media,system:media.system+local.nativeSystemBytes});setHistory(local);},[userId]);
 useEffect(()=>{let active=true;mounted.current=true;setLimit(cacheLimit());const update=()=>{if(active)void refresh().catch(()=>{if(active)setProblem('Хранилище временно недоступно');});};update();window.addEventListener('connect:cache-changed',update);window.addEventListener('connect:history-cache-changed',update);return()=>{active=false;mounted.current=false;window.removeEventListener('connect:cache-changed',update);window.removeEventListener('connect:history-cache-changed',update);};},[refresh]);
 async function clear(category:CacheCategory|'temporary'|'history'){
  const label=category==='history'?'локальную историю переписок':category==='temporary'?'временные медиа':names[category];
  if(!confirm('Очистить '+label+'? Сообщения на сервере сохранятся. Файлы загрузятся снова по необходимости.'))return;
  setBusy(true);try{if(category==='history')await wipeUserHistory(userId);else await clearCachedMedia(category);await refresh();setProblem('');}catch{setProblem('Не удалось очистить кеш. Повторите действие.');}finally{setBusy(false);}
 }
 async function changeLimit(value:string){setBusy(true);try{await setNativeHistoryLimit(userId,value);setCacheLimit(value);setLimit(value);await refresh();setProblem('');}catch{setProblem('Не удалось сохранить лимит');}finally{setBusy(false);}}
 const total=stats&&history?Object.values(stats).reduce((a,b)=>a+b,0)+history.bytes:null;
 return <div className="settings-group data-settings connect-cache-settings"><strong>Управление кешем</strong>
  <p className="settings-hint">Ресурсы интерфейса встроены в приложение. Авторизация, ключи, настройки, черновики и актуальные аватары сохраняются при обычной очистке.</p>
  <p>Всего: {total===null?'…':size(total)}</p>
  <div className="connect-cache-row"><span>История переписок<small>{history?`${history.chats} чатов · ${history.messages} сообщений · ${size(history.bytes)}`:'…'} — серверная история сохранится</small></span><button type="button" disabled={busy||!history?.messages} onClick={()=>void clear('history')}>Очистить</button></div>
  {(Object.keys(names)as CacheCategory[]).map(category=><div className="connect-cache-row" key={category}><span>{names[category]}<small>{stats?size(stats[category]):'…'}</small></span>{category!=='system'&&<button type="button" disabled={busy||!stats?.[category]} onClick={()=>void clear(category)}>Очистить</button>}</div>)}
  <label>Лимит временных данных<select value={limit} disabled={busy} onChange={e=>void changeLimit(e.target.value)}><option value="500">500 МБ</option><option value="1000">1 ГБ</option><option value="2000">2 ГБ</option><option value="auto">Автоматически</option></select></label>
  <button type="button" className="settings-action secondary" disabled={busy} onClick={()=>void clear('temporary')}>Очистить временные медиа</button>{problem&&<p role="alert">{problem}</p>}
 </div>;
}
