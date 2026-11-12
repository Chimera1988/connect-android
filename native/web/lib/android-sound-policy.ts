/** Android-only meanings; the existing server sound enum remains unchanged. */
export type NotificationTone='soft'|'bright'|'gentle'|'silent'|'legacy-soft';
export type NotificationPrefs={enabled:boolean;vibrate:boolean;sound:NotificationTone};
export const NOTIFICATION_KEY='connect-native-notifications-v1';
export const TONE_LABELS:Record<NotificationTone,string>={soft:'Connect — сообщение',bright:'Яркий',gentle:'Нежный','legacy-soft':'Мягкий (прежний)',silent:'Без звука'};
export function isNotificationTone(value:unknown):value is NotificationTone{return typeof value==='string'&&Object.prototype.hasOwnProperty.call(TONE_LABELS,value);}
export function parseNotificationPrefs(value:unknown):NotificationPrefs{
 const p=(value&&typeof value==='object'?value:{}) as Partial<NotificationPrefs>;
 return {enabled:typeof p.enabled==='boolean'?p.enabled:true,vibrate:typeof p.vibrate==='boolean'?p.vibrate:true,sound:isNotificationTone(p.sound)?p.sound:'soft'};
}
export function notificationResource(tone:NotificationTone):string{
 return tone==='soft'?'connect_notification':tone==='legacy-soft'?'connect_soft':'connect_'+tone;
}
/** The Android-only old-soft choice round-trips through the existing server enum. */
export function serverNotificationPrefs(p:NotificationPrefs){return {...p,sound:p.sound==='legacy-soft'?'soft':p.sound};}
export function mergeServerNotificationPrefs(remote:NotificationPrefs,local:NotificationPrefs):NotificationPrefs{
 return remote.sound==='soft'&&local.sound==='legacy-soft'?{...remote,sound:'legacy-soft'}:remote;
}
