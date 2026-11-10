'use client';

import { useEffect, useState } from 'react';

type Member = { id:string; display_name:string; is_hidden:boolean };
type Props = {
  request: (path:string, body?:object) => Promise<{members?:Member[];ok?:boolean}>;
  onChanged: () => void;
};

export default function ConnectHiddenMembers({request,onChanged}:Props){
  const [members,setMembers]=useState<Member[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    void request('/api/admin/hidden-members').then(data=>{
      if(alive)setMembers(data.members||[]);
    }).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Не удалось загрузить участников');})
      .finally(()=>{if(alive)setLoading(false)});
    return()=>{alive=false};
    // Request uses the current session; load once when the admin panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function setHidden(member:Member){
    setBusy(member.id);setError('');
    try{
      await request('/api/admin/hidden-members',{user_id:member.id,hidden:!member.is_hidden});
      setMembers(old=>old.map(m=>m.id===member.id?{...m,is_hidden:!m.is_hidden}:m));
      onChanged();
    }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить статус')}
    finally{setBusy('')}
  }
  return <>
    <strong>Статусы участников</strong>
    <p className="settings-hint">Скрытый участник видит только администратора. Изменения не удаляют переписки.</p>
    {loading?<p className="settings-hint">Загрузка участников…</p>:members.length===0?<p className="settings-hint">Пока нет других участников.</p>:members.map(m=><div key={m.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'10px 0',borderBottom:'1px solid var(--border)'}}>
      <div style={{minWidth:0,overflowWrap:'anywhere'}}><strong>{m.display_name||'Без имени'}</strong><div className="settings-hint" style={{margin:0}}>{m.is_hidden?'Скрытый':'Обычный'}</div></div>
      <button type="button" className="settings-action secondary" style={{width:'auto',margin:0,padding:'8px 10px',fontSize:12}} disabled={Boolean(busy)} onClick={()=>void setHidden(m)}>{busy===m.id?'…':m.is_hidden?'Сделать обычным':'Скрыть'}</button>
    </div>)}
    {error&&<p role="alert" style={{color:'#ff9c9c'}}>{error}</p>}
  </>;
}
