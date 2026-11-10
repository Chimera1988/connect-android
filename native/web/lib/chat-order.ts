/** Preserve Postgres microseconds; Date.parse alone collapses tied milliseconds. */
export function chatTimeKey(value:string):string{
  const time=Date.parse(value);if(!Number.isFinite(time))return '';
  const fraction=/T\d\d:\d\d:\d\d\.(\d+)/.exec(value)?.[1]||'';
  return new Date(time).toISOString().slice(0,19)+'.'+fraction.padEnd(6,'0').slice(0,6);
}
export function compareChatMessages(a:{id:string;created_at:string},b:{id:string;created_at:string}){
  return chatTimeKey(a.created_at).localeCompare(chatTimeKey(b.created_at))||a.id.localeCompare(b.id);
}
