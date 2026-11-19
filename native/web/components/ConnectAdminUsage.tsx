'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {cacheStats} from '../lib/media-cache';

interface BucketUsage {id:string;bytes:number;files:number;monthBytes:number}
interface UsageResponse {
  checkedAt:string;
  databaseBytes:number;
  storageBytes:number;
  storageFiles:number;
  monthStoredBytes:number;
  buckets:BucketUsage[];
  traffic:{egressBytes:null;cachedEgressBytes:null;source:string};
}
const MiB=1024**2;
const GiB=1024**3;
const BUCKET_NAMES:Record<string,string>={
  'connect-attachments':'Вложения в чатах',
  'connect-avatars':'Аватары',
  'connect-profile-media':'Медиатека профилей',
  'connect-stickers':'Стикеры',
};
const dashboard='https://supabase.com/dashboard/project/tpwkmoxxzjfdsqsomhhr';
const safeNumber=(value:number)=>Number.isFinite(value)&&value>=0?value:0;
function size(value:number):string {
  const bytes=safeNumber(value);
  if(bytes>=GiB)return (bytes/GiB).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ГБ';
  if(bytes>=MiB)return (bytes/MiB).toLocaleString('ru-RU',{maximumFractionDigits:1})+' МБ';
  if(bytes>=1024)return (bytes/1024).toLocaleString('ru-RU',{maximumFractionDigits:1})+' КБ';
  return bytes.toLocaleString('ru-RU')+' Б';
}
function Gauge({label,value,comparison,detail,muted=false}:{label:string;value:number|null;comparison:number;detail:string;muted?:boolean}){
  const valid=value!==null&&Number.isFinite(value)&&value>=0;
  const ratio=valid?Math.min(100,value!/comparison*100):0;
  return <div className={'connect-usage-gauge'+(muted?' is-muted':'')}>
    <div className="connect-usage-gauge-head"><strong>{label}</strong><span>{valid?`${size(value!)} / ${size(comparison)}`:'Нет данных'}</span></div>
    <div className="connect-usage-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={valid?Math.round(ratio):undefined} aria-valuetext={valid?`${size(value!)} относительно контрольного порога ${size(comparison)}`:'Данные недоступны'}>
      <span className="connect-usage-fill" style={{width:valid?`${ratio}%`:'0%'}}/>
    </div>
    <small>{detail}</small>
  </div>;
}

export default function ConnectAdminUsage({supabase,userId}:{supabase:SupabaseClient;userId:string}){
  const [usage,setUsage]=useState<UsageResponse|null>(null);
  const [localBytes,setLocalBytes]=useState<number|null>(null);
  const [loading,setLoading]=useState(false);
  const [problem,setProblem]=useState('');
  const [storageGoal,setStorageGoal]=useState(GiB);
  const [dbGoal,setDbGoal]=useState(500*MiB);
  const [monthGoal,setMonthGoal]=useState(GiB);
  const busy=useRef(false);
  const active=useRef(true);
  const load=useCallback(async()=>{
    if(busy.current)return;
    busy.current=true;setLoading(true);setProblem('');
    try {
      const {data:{session},error:authError}=await supabase.auth.getSession();
      if(authError||session?.user.id!==userId||!session.access_token)throw Error('Войдите в аккаунт повторно');
      const response=await fetch('/api/admin/usage',{
        method:'GET',credentials:'same-origin',cache:'no-store',
        headers:{Authorization:`Bearer ${session.access_token}`},
      });
      const result=await response.json().catch(()=>({error:'Не удалось прочитать ответ сервера'}));
      if(!response.ok)throw Error(typeof result.error==='string'?result.error:'Не удалось обновить статистику');
      if(!Number.isFinite(result.storageBytes)||!Number.isFinite(result.databaseBytes)||!Array.isArray(result.buckets))throw Error('Неверный формат данных');
      if(active.current)setUsage(result as UsageResponse);
      const cached=await cacheStats().catch(()=>null);
      if(active.current)setLocalBytes(cached?Object.values(cached).reduce((sum,n)=>sum+safeNumber(n),0):null);
    }catch(error){if(active.current)setProblem(error instanceof Error?error.message:'Ошибка получения статистики');}
    finally{busy.current=false;if(active.current)setLoading(false);}
  },[supabase,userId]);
  useEffect(()=>{
    active.current=true;
    void load();
    const refresh=()=>{if(document.visibilityState==='visible')void load();};
    const timer=window.setInterval(refresh,60000);
    return()=>{active.current=false;window.clearInterval(timer);};
  },[load]);

  return <section className="connect-admin-usage" aria-label="Администрирование: хранилище и трафик">
    <div className="connect-usage-summary">
      <div className="connect-usage-summary-head"><div><span className="connect-usage-eyebrow">CONNECT · АДМИНИСТРИРОВАНИЕ</span><h2>Хранилище и трафик</h2><p>Использование Supabase без лишних запросов</p></div><span className="connect-usage-pulse" aria-hidden="true"/></div>
      <div className="connect-usage-totals">
        <div><small>Объекты Storage</small><strong>{usage?size(usage.storageBytes):'—'}</strong></div>
        <div><small>База данных</small><strong>{usage?size(usage.databaseBytes):'—'}</strong></div>
      </div>
      <div className="connect-usage-toolbar"><span>{usage?`Обновлено ${new Date(usage.checkedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:'Показатели ещё не загружены'}</span><button type="button" onClick={()=>void load()} disabled={loading}>{loading?'Обновление…':'Обновить'}</button></div>
    </div>

    {problem&&<p className="connect-usage-error" role="alert">{problem}</p>}
    <div className="connect-usage-panel">
      <div className="connect-usage-title"><h3>Хранилище</h3><span>{usage?`${usage.storageFiles} файлов`:'—'}</span></div>
      <div className="connect-usage-limit"><span>Контрольный порог Storage</span><select aria-label="Контрольный порог Storage" value={storageGoal} onChange={e=>setStorageGoal(Number(e.target.value))}><option value={250*MiB}>250 МБ</option><option value={GiB}>1 ГБ</option><option value={5*GiB}>5 ГБ</option><option value={20*GiB}>20 ГБ</option><option value={100*GiB}>100 ГБ</option></select></div>
      <Gauge label="Все файлы Supabase" value={usage?.storageBytes??null} comparison={storageGoal} detail="Текущий размер объектов, не среднее за расчётный период"/>
      <div className="connect-usage-limit"><span>Контрольный порог базы</span><select aria-label="Контрольный порог базы" value={dbGoal} onChange={e=>setDbGoal(Number(e.target.value))}><option value={500*MiB}>500 МБ</option><option value={2*GiB}>2 ГБ</option><option value={8*GiB}>8 ГБ</option><option value={20*GiB}>20 ГБ</option></select></div>
      <Gauge label="База PostgreSQL" value={usage?.databaseBytes??null} comparison={dbGoal} detail="Размер PostgreSQL (не полный занятый объём диска)"/>
      <p className="connect-usage-note">Пороги задают только масштаб шкал и не считаются лимитами тарифа Supabase.</p>
      <h4>По категориям</h4>
      {usage?.buckets.length ? usage.buckets.map(item=><div className="connect-usage-category" key={item.id}>
        <div className="connect-usage-category-head"><span>{BUCKET_NAMES[item.id]||item.id}</span><strong>{size(item.bytes)}</strong></div>
        <div className="connect-usage-mini"><span style={{width:`${Math.min(100,item.bytes/Math.max(usage.storageBytes,1)*100)}%`}}/></div>
        <small>{item.files} файлов · {usage.storageBytes?Math.round(item.bytes/usage.storageBytes*100):0}% общего объёма</small>
      </div>) : <p className="connect-usage-note">{usage?'Файлы не найдены':'Загрузка категорий…'}</p>}
      <div className="connect-usage-local">Кеш на этом устройстве <strong>{localBytes===null?'Недоступен':size(localBytes)}</strong></div>
    </div>

    <div className="connect-usage-panel">
      <div className="connect-usage-title"><h3>Трафик</h3><span>Календарный месяц · UTC</span></div>
      <div className="connect-usage-limit"><span>Ориентир новых файлов</span><select aria-label="Ориентир новых файлов" value={monthGoal} onChange={e=>setMonthGoal(Number(e.target.value))}><option value={250*MiB}>250 МБ</option><option value={GiB}>1 ГБ</option><option value={5*GiB}>5 ГБ</option><option value={20*GiB}>20 ГБ</option></select></div>
      <Gauge label="Новые файлы за месяц" value={usage?.monthStoredBytes??null} comparison={monthGoal} detail="Сумма сохранившихся загруженных файлов, не полный сетевой трафик"/>
      <Gauge label="Исходящий трафик Supabase (egress)" value={null} comparison={5*GiB} detail="Точные данные находятся в отчётах Supabase; эта шкала не подменяется оценкой" muted/>
      <a className="connect-usage-dashboard-link" href={dashboard} target="_blank" rel="noopener noreferrer">Отчёты Supabase <span aria-hidden="true">↗</span></a>
      <p className="connect-usage-note">Egress включает Storage, API, авторизацию и Realtime, в том числе кешированные ответы. Для точной шкалы нужен поддерживаемый источник официальной статистики.</p>
    </div>
    <p className="connect-usage-footnote">Данные обновляются по кнопке и раз в минуту, пока эта страница открыта. Доступ предоставляется только администратору.</p>
  </section>;
}
