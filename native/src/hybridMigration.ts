import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import {db} from './backend';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCENES=new Set(['waves','aurora','moon','sunset','lagoon','nebula','minimal']);
const PACKS=new Set(['speed','blocks','anime-boys','anime-girls']);
const MOODS=new Set(['hello','love','laugh','wow','sad','angry','wink','sleep','thanks','cool','facepalm','thinking','cry','shy','party','hug','nope','yes','shock','heart','coffee','gaming','bye','tired']);
type ObjectValue=Record<string,unknown>;
function object(value:unknown):value is ObjectValue{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function parse(value:string|null):unknown{try{return value?JSON.parse(value):null;}catch{return null;}}
async function read(key:string){return SecureStore.getItemAsync(key).catch(()=>null);}
function uniqueStrings(value:unknown,valid:(item:string)=>boolean):string[]{
  return Array.isArray(value)?Array.from(new Set(value.filter((item):item is string=>typeof item==='string'&&valid(item)))):[];
}
function builtIn(value:string){const [pack,mood,...rest]=value.split(':');return !rest.length&&PACKS.has(pack)&&MOODS.has(mood);}

/** Read-only upgrade adapter. The host seeds ONLY absent PWA localStorage keys.
 * SecureStore entries and native sound/media files are deliberately retained.
 * Profiles, privacy rules, custom sticker packs, and read receipts already use
 * the same server tables; no account or database migration is performed.
 */
export async function legacyWebStorage(ownerId:string):Promise<Record<string,string>>{
  if(!UUID.test(ownerId))return {};
  const {data:{session}}=await db.auth.getSession();
  if(session?.user.id!==ownerId)return {};
  const result:Record<string,string>=Object.create(null);
  const keys=[
    'connect-native-pwa-appearance-v2','connect-native-theme-v1',
    'connect-native-sticker-favorites-v1.'+ownerId,'connect-native-sticker-recent-v1.'+ownerId,
    'connect-native-cleared-chats.'+ownerId,'connect-native-notifications-v1',
    'connect-native-last-viewed-calls-'+ownerId,'connect-native-music-playback-v1',
    'connect-native-music-mini-bottom-v1','connect-sonic-runner-best-v1',
  ];
  const [appearanceRaw,oldScene,favoritesRaw,recentRaw,clearedRaw,notificationRaw,callsRaw,musicRaw,miniRaw,bestRaw]=await Promise.all(keys.map(read));
  const appearance=parse(appearanceRaw);
  if(object(appearance)){
    if(appearance.mode==='dark'||appearance.mode==='light')result['connect-theme']=appearance.mode;
    const scene=appearance.scene==='glow'?'aurora':appearance.scene;
    if(typeof scene==='string'&&SCENES.has(scene))result['connect-visual-scene']=scene;
    if(typeof appearance.accent==='string'&&/^#[0-9a-f]{6}$/i.test(appearance.accent))result['connect-accent']=appearance.accent;
    if(Array.isArray(appearance.enabledPacks))result['connect-sticker-packs']=JSON.stringify(uniqueStrings(appearance.enabledPacks,id=>PACKS.has(id)));
    // Only the exact legacy wallpaper file is eligible. Never bridge arbitrary
    // private filesystem paths, or the URI itself, into the WebView.
    const wallpaper=appearance.wallpaper;
    if(typeof wallpaper==='string'&&FileSystem.documentDirectory&&wallpaper===FileSystem.documentDirectory+'connect-native-chat-wallpaper.jpg')try{
      const info=await FileSystem.getInfoAsync(wallpaper);
      if(info.exists&&!info.isDirectory&&info.size>0&&info.size<=12*1024*1024){
        const encoded=await FileSystem.readAsStringAsync(wallpaper,{encoding:FileSystem.EncodingType.Base64});
        const mime=encoded.startsWith('iVBOR')?'png':encoded.startsWith('R0lGOD')?'gif':encoded.startsWith('UklGR')?'webp':'jpeg';
        result['connect-android-legacy-wallpaper']='data:image/'+mime+';base64,'+encoded;
      }
    }catch{/* Original native file stays available if import cannot run yet. */}
  }else if(oldScene){
    const scene=oldScene==='glow'?'aurora':oldScene;
    if(SCENES.has(scene))result['connect-visual-scene']=scene;
  }
  if(Array.isArray(parse(favoritesRaw)))result['connect-sticker-favorites']=JSON.stringify(uniqueStrings(parse(favoritesRaw),builtIn).slice(0,100));
  if(Array.isArray(parse(recentRaw)))result['connect-sticker-recent']=JSON.stringify(uniqueStrings(parse(recentRaw),builtIn).slice(0,30));
  const cleared=parse(clearedRaw);
  if(object(cleared))result['connect-cleared-chats:'+ownerId]=JSON.stringify(Object.fromEntries(Object.entries(cleared)
    .filter(([id,value])=>UUID.test(id)&&typeof value==='string'&&Number.isFinite(Date.parse(value)))));
  const notification=parse(notificationRaw);
  if(object(notification)&&typeof notification.enabled==='boolean'&&typeof notification.vibrate==='boolean'&&
    ['soft','bright','gentle','silent','legacy-soft'].includes(String(notification.sound)))
    result['connect-notification-prefs-'+ownerId]=JSON.stringify({enabled:notification.enabled,vibrate:notification.vibrate,sound:notification.sound});
  if(callsRaw&&Number.isFinite(Number(callsRaw))&&Number(callsRaw)>0)result['connect-last-viewed-calls:'+ownerId]=callsRaw;
  const music=parse(musicRaw);
  if(object(music)&&typeof music.ownerId==='string'&&UUID.test(music.ownerId)&&typeof music.path==='string'&&music.path.length<=2048)
    result['connect-profile-music-playback-v1']=JSON.stringify({ownerId:music.ownerId,path:music.path,
      position:typeof music.position==='number'&&Number.isFinite(music.position)?Math.max(0,music.position):0,
      shuffle:music.shuffle===true,repeat:music.repeat===true,muted:music.muted===true,volume:.85});
  if(miniRaw&&Number.isFinite(Number(miniRaw))&&Number(miniRaw)>=0)result['connect-music-mini-bottom-v1']=miniRaw;
  if(bestRaw&&Number.isFinite(Number(bestRaw))&&Number(bestRaw)>=0)result['connect-sonic-runner-best-v1']=bestRaw;

  // SecureStore cannot enumerate keys. Discover only this user's existing
  // conversations through the current authenticated RLS connection. Paginate so
  // an old chat's local deletions are not lost after the first server page.
  const hidden=new Set<string>();
  for(let offset=0;;offset+=500){
    const page=await db.from('conversations').select('id').or('user_a.eq.'+ownerId+',user_b.eq.'+ownerId)
      .order('id',{ascending:true}).range(offset,offset+499);
    if(page.error)throw new Error('Не удалось перенести локальное скрытие сообщений: '+page.error.message);
    const conversations=(page.data||[]).filter(row=>typeof row.id==='string'&&UUID.test(row.id));
    await Promise.all(conversations.map(async row=>{
      const raw=await read('connect-native-chat-hidden-v1.'+ownerId+'.'+row.id);
      for(const id of uniqueStrings(parse(raw),id=>UUID.test(id)))hidden.add(id);
    }));
    if(!page.data||page.data.length<500)break;
  }
  // No placeholder empty array: a retry after temporary storage errors must
  // still be able to seed deletions, and existing PWA keys remain untouched.
  if(hidden.size)result['connect-hidden-messages:'+ownerId]=JSON.stringify([...hidden]);
  // Native scroll anchors were in-memory only. last_read_at stays authoritative
  // on the server; native FCM read-marker SecureStore entries are not rewritten.
  return result;
}
