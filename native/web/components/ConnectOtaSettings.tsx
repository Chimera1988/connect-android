import {useEffect,useState} from 'react';

type OtaInfo={version:string;build:number|null;enabled:boolean;pending:boolean;channel:string|null;runtime:string|null;embedded:boolean;downloading?:boolean;downloadProgress?:number|null};
type OtaProgressEvent={downloading:boolean;progress:number|null};
function validFraction(value:unknown):number|null{
  return typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):null;
}
type OtaState='loading'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'restarting'|'disabled'|'error';
type ApkInfo={state:'unpublished'|'current'|'available';version?:string;build?:number;size?:number};
type ApkState='checking'|'unpublished'|'current'|'available'|'opening'|'opened'|'error';

/** Both update paths use only the nonce-bound Android bridge. WebView never chooses an APK URL. */
export default function ConnectOtaSettings(){
  const [info,setInfo]=useState<OtaInfo|null>(null);
  const [state,setState]=useState<OtaState>('loading');
  const [error,setError]=useState('');
  const [downloadFraction,setDownloadFraction]=useState<number|null>(null);
  const [apkInfo,setApkInfo]=useState<ApkInfo|null>(null);
  const [apkState,setApkState]=useState<ApkState>('checking');
  const [apkError,setApkError]=useState('');
  useEffect(()=>{
    const handle=(event:Event)=>{
      const data=(event as CustomEvent<OtaProgressEvent>).detail;
      if(!data||data.downloading!==true)return;
      setState(old=>old==='ready'||old==='restarting'||old==='disabled'?old:'downloading');
      const fraction=validFraction(data.progress);
      if(fraction!==null)setDownloadFraction(old=>Math.max(old??0,fraction));
    };
    window.addEventListener('connect:ota-progress',handle);
    return()=>window.removeEventListener('connect:ota-progress',handle);
  },[]);
  useEffect(()=>{
    let alive=true;
    const bridge=window.ConnectNative;
    if(!bridge){setState('disabled');setApkState('error');setApkError('Android недоступен');return;}
    void bridge.request('updates:info',{}).then((value:OtaInfo)=>{
      if(!alive)return;
      setInfo(value);
      setDownloadFraction(value.pending?1:validFraction(value.downloadProgress));
      setState(!value.enabled?'disabled':value.pending?'ready':value.downloading?'downloading':'idle');
    }).catch((reason:unknown)=>{
      if(!alive)return;
      setError(reason instanceof Error?reason.message:'Не удалось проверить состояние обновлений.');
      setState('error');
    });
    void bridge.request('updates:apk-check',{}).then((value:ApkInfo)=>{
      if(!alive)return;
      setApkInfo(value);setApkState(value.state);
    }).catch((reason:unknown)=>{
      if(!alive)return;
      setApkError(reason instanceof Error?reason.message:'Не удалось проверить новые APK.');
      setApkState('error');
    });
    return()=>{alive=false;};
  },[]);
  async function run(command:'updates:check'|'updates:download'|'updates:apply'){
    const bridge=window.ConnectNative;
    if(!bridge)return;
    setError('');
    if(command!=='updates:apply')setDownloadFraction(null);
    setState(command==='updates:check'?'checking':command==='updates:download'?'downloading':'restarting');
    try{
      const response=await bridge.request(command,{});
      if(command==='updates:apply')return;
      const next=response?.state;
      if(next==='available'||next==='ready'||next==='current'){
        if(next==='ready')setDownloadFraction(1);
        else if(next==='current')setDownloadFraction(null);
        setState(next);
      }
      else throw Error('Android вернул неизвестное состояние обновления.');
    }catch(reason){
      setError(reason instanceof Error?reason.message:'Не удалось выполнить обновление.');
      setState('error');
    }
  }
  async function checkApk(){
    const bridge=window.ConnectNative;
    if(!bridge)return;
    setApkError('');setApkState('checking');
    try{
      const result=await bridge.request('updates:apk-check',{}) as ApkInfo;
      if(!['current','available','unpublished'].includes(result?.state))throw Error('Некорректный ответ Android');
      setApkInfo(result);setApkState(result.state);
    }catch(reason){
      setApkError(reason instanceof Error?reason.message:'Не удалось проверить APK.');
      setApkState('error');
    }
  }
  async function openApk(){
    const bridge=window.ConnectNative;
    if(!bridge)return;
    setApkError('');setApkState('opening');
    try{
      const result=await bridge.request('updates:apk-open',{});
      if(result?.state!=='opened')throw Error('Android не подтвердил открытие загрузки');
      setApkState('opened');
    }catch(reason){
      setApkError(reason instanceof Error?reason.message:'Не удалось открыть скачивание APK.');
      setApkState('error');
    }
  }
  const progress=state==='checking'||state==='downloading'||state==='restarting';
  const showProgress=progress||state==='ready';
  const progressPercent=state==='ready'?100:state==='downloading'&&downloadFraction!==null?Math.round(downloadFraction*100):null;
  const status=state==='loading'?'Получаем сведения о версии…':
    state==='checking'?'Проверяем обновления…':state==='downloading'?'Скачиваем проверенное обновление…':
    state==='restarting'?'Перезапускаем Connect…':state==='available'?'Доступно совместимое обновление интерфейса.':
    state==='ready'?'Обновление загружено и готово к применению.':
    state==='current'?'Обновлений интерфейса пока нет.':
    state==='disabled'?'Автоматические обновления недоступны в этой сборке.':
    state==='error'?error:'Проверка обновлений доступна.';
  const apkStatus=apkState==='checking'?'Проверяем выпуски Connect для Android…':
    apkState==='unpublished'?'Подписанные APK ещё не опубликованы в разделе Releases.':
    apkState==='current'?'Установлена последняя опубликованная версия Android.':
    apkState==='available'?`Доступна версия ${apkInfo?.version} (${apkInfo?.build}), ${apkInfo?.size?Math.round(apkInfo.size/1048576):'?'} МиБ.`:
    apkState==='opening'?'Открываем загрузку APK…':
    apkState==='opened'?'Загрузка открыта. Скачайте APK и подтвердите установку в Android.':
    apkError;
  return <div className="settings-group data-settings connect-ota-about">
    <strong>Connect Messenger</strong>
    <p>Версия {info?.version?(info.build===null?info.version:`${info.version} (${info.build})`):'определяется…'}</p>
    <p><strong>Разработчики: Алина и Кирилл</strong></p>
    <p className="settings-hint">Мессенджер для личного общения.</p>
    <div className="connect-ota-rule"/>
    <strong>Обновление приложения</strong>
    <p className="settings-hint"><strong>Обновления интерфейса</strong></p>
    <p className="settings-hint">Совместимые изменения интерфейса загружаются по воздуху через Expo, без установки APK.</p>
    <p className="connect-ota-status" role="status" aria-live="polite">{status}</p>
    {showProgress&&<div className="connect-ota-progress-area">
      <div className={'connect-ota-progress-track'+(progressPercent===null?' is-indeterminate':'')}
        role="progressbar" aria-label="Загрузка обновления интерфейса"
        aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={progressPercent===null?undefined:progressPercent}
        aria-valuetext={progressPercent===null?status:`${progressPercent}%`}>
        <span className="connect-ota-progress-fill" style={progressPercent===null?undefined:{width:`${progressPercent}%`}}/>
      </div>
      <p className="settings-hint connect-ota-progress-caption">
        {state==='ready'?'Загружено 100% — можно применить обновление.':
          state==='downloading'?(progressPercent===null?'Загружаем… процент пока недоступен.':`Загружено ${progressPercent}%`):status}
      </p>
    </div>}
    {state==='ready'?<button type="button" className="settings-action" disabled={progress} onClick={()=>void run('updates:apply')}>Применить и перезапустить</button>:
      state==='available'?<button type="button" className="settings-action" disabled={progress} onClick={()=>void run('updates:download')}>Скачать обновление</button>:
      state!=='disabled'&&state!=='loading'&&state!=='restarting'?<button type="button" className="settings-action" disabled={progress} onClick={()=>void run('updates:check')}>Проверить обновления интерфейса</button>:null}
    {info?.enabled&&<p className="settings-hint">Канал: {info.channel||'неизвестен'}. Connect также проверяет Expo при обычном запуске.</p>}
    <div className="connect-ota-rule"/>
    <strong>Новая версия Android (APK)</strong>
    <p className="settings-hint">Для изменений звонков и системных функций Connect проверяет только подписанные выпуски из официального GitHub-репозитория.</p>
    <p className="connect-ota-status" role="status" aria-live="polite">{apkStatus}</p>
    {apkState==='available'?<button type="button" className="settings-action" onClick={()=>void openApk()}>Скачать APK {apkInfo?.version}</button>:null}
    {apkState!=='checking'&&apkState!=='opening'?<button type="button" className="settings-action secondary" onClick={()=>void checkApk()}>Проверить версию Android</button>:null}
    <p className="settings-hint">APK скачивается через системный браузер. Android попросит подтвердить установку. Не удаляйте старую версию: при совпадении подписи обновление установится поверх неё.</p>
  </div>;
}
