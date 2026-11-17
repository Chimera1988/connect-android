import {useEffect,useState} from 'react';

type OtaInfo={version:string;build:number|null;enabled:boolean;pending:boolean;channel:string|null;runtime:string|null;embedded:boolean};
type OtaState='loading'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'restarting'|'disabled'|'error';

/** Uses the authenticated, nonce-bound Android bridge. Never fetch Expo URLs from WebView. */
export default function ConnectOtaSettings(){
  const [info,setInfo]=useState<OtaInfo|null>(null);
  const [state,setState]=useState<OtaState>('loading');
  const [error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    const bridge=window.ConnectNative;
    if(!bridge){setState('disabled');return;}
    void bridge.request('updates:info',{}).then((value:OtaInfo)=>{
      if(!alive)return;
      setInfo(value);
      setState(!value.enabled?'disabled':value.pending?'ready':'idle');
    }).catch((reason:unknown)=>{
      if(!alive)return;
      setError(reason instanceof Error?reason.message:'Не удалось проверить состояние обновлений.');
      setState('error');
    });
    return()=>{alive=false;};
  },[]);
  async function run(command:'updates:check'|'updates:download'|'updates:apply'){
    const bridge=window.ConnectNative;
    if(!bridge)return;
    setError('');
    setState(command==='updates:check'?'checking':command==='updates:download'?'downloading':'restarting');
    try{
      const response=await bridge.request(command,{});
      if(command==='updates:apply')return; // A successful apply restarts the native app.
      const next=response?.state;
      if(next==='available'||next==='ready'||next==='current')setState(next);
      else throw Error('Android вернул неизвестное состояние обновления.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Не удалось выполнить обновление.');
      setState('error');
    }
  }
  const progress=state==='checking'||state==='downloading'||state==='restarting';
  const status=state==='loading'?'Получаем сведения о версии…':
    state==='checking'?'Проверяем обновления…':state==='downloading'?'Скачиваем проверенное обновление…':
    state==='restarting'?'Перезапускаем Connect…':state==='available'?'Доступно совместимое обновление интерфейса.':
    state==='ready'?'Обновление загружено и готово к применению.':
    state==='current'?'Обновлений интерфейса пока нет.':
    state==='disabled'?'Автоматические обновления недоступны в этой сборке.':
    state==='error'?error:'Проверка обновлений доступна.';
  return <div className="settings-group data-settings connect-ota-about">
    <strong>Connect Messenger</strong>
    <p>Версия {info?.version?(info.build===null?info.version:`${info.version} (${info.build})`):'определяется…'}</p>
    <p><strong>Разработчики: Алина и Кирилл</strong></p>
    <p className="settings-hint">Мессенджер для личного общения.</p>
    <div className="connect-ota-rule"/>
    <strong>Обновление приложения</strong>
    <p className="settings-hint">Исправления интерфейса загружаются по воздуху. Новые системные возможности Android по-прежнему требуют отдельного APK.</p>
    <p className="connect-ota-status" role="status" aria-live="polite">{status}</p>
    {state==='ready'?<button type="button" className="settings-action" disabled={progress} onClick={()=>void run('updates:apply')}>Применить и перезапустить</button>:
      state==='available'?<button type="button" className="settings-action" disabled={progress} onClick={()=>void run('updates:download')}>Скачать обновление</button>:
      state!=='disabled'&&state!=='loading'&&state!=='restarting'?<button type="button" className="settings-action" disabled={progress} onClick={()=>void run('updates:check')}>Проверить обновления</button>:null}
    {info?.enabled&&<p className="settings-hint">Канал: {info.channel||'неизвестен'}. При обычном запуске Connect также автоматически проверяет наличие обновлений.</p>}
  </div>;
}
