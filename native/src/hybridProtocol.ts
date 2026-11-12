/** The only document permitted to call native APIs is the bundled Connect UI.
 * loadDataWithBaseURL gives that document this HTTPS origin. Navigation to new
 * documents must still be blocked by the host; an origin check is not a CSP.
 */
export const CONNECT_ORIGIN = 'https://connect-chat.duckdns.org';
export const MAX_BRIDGE_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const ID = /^[A-Za-z0-9_:-]{1,80}$/;
const TONES = new Set(['soft', 'bright', 'gentle', 'silent', 'legacy-soft']);
const KINDS = new Set(['call', 'message']);

export type HybridCommand =
  | 'calls:journal'
  | 'history:catalog-retire' | 'history:catalog-read' | 'history:catalog-write' | 'history:catalog-drop'
  | 'history:read' | 'history:page' | 'history:chunk' | 'history:write' | 'history:drop' | 'history:wipe' | 'history:stats' | 'history:limit'
  | 'appearance' | 'vault:seal' | 'vault:open'
  | 'migration:get' | 'bridge:ready' | 'file:ack' | 'file:cancel'
  | 'files:begin' | 'files:chunk' | 'files:end' | 'files:cancel'
  | 'session' | 'register' | 'preferences' | 'activeConversation' | 'read'
  | 'sounds:get' | 'sounds:pick' | 'sounds:reset' | 'sounds:preview'
  | 'sounds:silent' | 'sounds:previewBuiltin' | 'sounds:stop'
  | 'calls:dial' | 'calls:accept' | 'calls:decline' | 'calls:end'
  | 'calls:timeout' | 'calls:uiReady' | 'calls:mute' | 'calls:speaker' | 'calls:route'
  | 'clipboard' | 'openExternal' | 'navigation:exit' | 'notification:settings'
  | 'recordVoice:start' | 'recordVoice:stop' | 'recordVoice:cancel' | 'recordVideo:open';

export type HybridMessage = {
  v: 1;
  nonce: string;
  id: string;
  command: HybridCommand;
  payload: Record<string, unknown> | null;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function text(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max && !value.includes('\u0000');
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
function accessToken(value: unknown): value is string {
  return text(value, 32768, 20) && TOKEN.test(value);
}
function optionalCall(value: Record<string, unknown>, required: string[] = []): boolean {
  return fields(value, required, ['callId']) &&
    (value.callId === undefined || uuid(value.callId));
}
function httpUrl(value: unknown): value is string {
  if (!text(value, 8192, 1) || /[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.username === '' && parsed.password === '';
  } catch { return false; }
}

/** Reject about:blank, file:, data:, credentials and lookalike/subdomain hosts. */
export function isTrustedHybridUrl(value: string): boolean {
  if (!httpUrl(value)) return false;
  try { return new URL(value).origin === CONNECT_ORIGIN; } catch { return false; }
}

export function safeCatalog(value:unknown,depth=0):boolean{
 if(depth>12)return false;
 if(typeof value==='string')return value.length<=4000&&!/[?&][^=]*(token|signature)[^=]*=|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(value);
 if(Array.isArray(value))return value.length<=300&&value.every(x=>safeCatalog(x,depth+1));
 if(record(value))return Object.entries(value).every(([key,v])=>!/(token|authorization|password|secret|signedurl|access_key|refresh_key)/i.test(key)&&safeCatalog(v,depth+1));
 return value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
}
function payloadValid(command: string, value: unknown): boolean {
  if (command === 'session' && value === null) return true;
  if (!record(value)) return false;
  switch (command) {
    case 'calls:journal':return fields(value,['userId','action'],['rows','at'])&&uuid(value.userId)&&['state','seed','view','close','reconcile'].includes(value.action as string)&&(value.rows===undefined||Array.isArray(value.rows)&&value.rows.length<=200&&value.rows.every(r=>record(r)&&fields(r,['id','conversation_id','caller_id','callee_id','status','created_at','answered_at','ended_at'],['hidden'])&&uuid(r.id)&&uuid(r.callee_id)&&uuid(r.caller_id)&&text(r.created_at,48,20)&&text(r.status,20)&&(r.answered_at===null||text(r.answered_at,48))&&(r.ended_at===null||text(r.ended_at,48))&&(r.hidden===undefined||typeof r.hidden==='boolean')))&&(value.at===undefined||Number.isFinite(value.at));
    case 'history:catalog-retire':return fields(value,['userId','key','path'])&&uuid(value.userId)&&text(value.key,90,1)&&/^profile:[a-fA-F0-9-]{36}:(photos|videos|music)$/.test(value.key as string)&&text(value.path,1000,1)&&!(value.path as string).includes('..')&&!/[?\\]/.test(value.path as string)&&safeCatalog(value.path);
    case 'history:catalog-read':case 'history:catalog-drop':return fields(value,['userId','key'])&&uuid(value.userId)&&text(value.key,90,1)&&/^(inbox|profile:[a-fA-F0-9-]{36}:(photos|videos|music))$/.test(value.key as string);
    case 'history:catalog-write':return fields(value,['userId','key','value','epoch'])&&uuid(value.userId)&&text(value.key,90,1)&&/^(inbox|profile:[a-fA-F0-9-]{36}:(photos|videos|music))$/.test(value.key as string)&&record(value.value)&&safeCatalog(value.value)&&Number.isSafeInteger(value.epoch)&&Number(value.epoch)>=0&&JSON.stringify(value.value).length<=90000;
    case 'history:read':return fields(value,['userId','conversationId'])&&uuid(value.userId)&&uuid(value.conversationId);
    case 'history:page':return fields(value,['userId','conversationId','before','beforeId'],['direction'])&&uuid(value.userId)&&uuid(value.conversationId)&&uuid(value.beforeId)&&text(value.before,40,20)&&Number.isFinite(Date.parse(value.before))&&(value.direction===undefined||value.direction==='before'||value.direction==='after');
    case 'history:chunk':return fields(value,['userId','continuation'])&&uuid(value.userId)&&uuid(value.continuation);
    case 'history:write':return fields(value,['userId','conversationId','messages','readAt','epoch'])&&uuid(value.userId)&&uuid(value.conversationId)&&Array.isArray(value.messages)&&value.messages.length<=500&&text(value.readAt,40)&&Number.isSafeInteger(value.epoch)&&Number(value.epoch)>=0&&value.messages.every(m=>record(m)&&uuid(m.id)&&m.conversation_id===value.conversationId&&text(m.created_at,40,20)&&Number.isFinite(Date.parse(m.created_at)));
    case 'history:drop':return fields(value,['userId','messageId'])&&uuid(value.userId)&&uuid(value.messageId);
    case 'history:wipe':return fields(value,['userId'],['conversationId'])&&uuid(value.userId)&&(value.conversationId===undefined||uuid(value.conversationId));
    case 'history:stats':return fields(value,['userId'])&&uuid(value.userId);
    case 'history:limit':return fields(value,['userId','limit'])&&uuid(value.userId)&&['auto','500','1000','2000'].includes(value.limit as string);
    case 'appearance':return fields(value,['scene'])&&['waves','aurora','moon','sunset','lagoon','nebula','minimal'].includes(value.scene as string);
    case 'vault:seal': case 'vault:open':
      return fields(value,['name','value'])&&text(value.name,180,1)&&/^[A-Za-z0-9:_-]+$/.test(value.name)&&text(value.value,command==='vault:seal'?49152:98304,1);
    case 'calls:timeout':return fields(value,['requestId','command'])&&text(value.requestId,80,1)&&ID.test(value.requestId)&&['calls:dial','calls:accept','calls:decline','calls:end','calls:mute','calls:speaker','calls:route'].includes(value.command as string);
    case 'session':
      return fields(value, ['access_token', 'refresh_token']) && accessToken(value.access_token) &&
        text(value.refresh_token, 8192, 1) && /^[A-Za-z0-9_-]+$/.test(value.refresh_token);
    case 'register': return fields(value, ['token']) && accessToken(value.token);
    case 'preferences':
      return fields(value, ['enabled', 'sound', 'vibrate']) && typeof value.enabled === 'boolean' &&
        typeof value.vibrate === 'boolean' && typeof value.sound === 'string' && TONES.has(value.sound);
    case 'activeConversation': return fields(value, ['id']) && (value.id === '' || uuid(value.id));
    case 'read':
      return fields(value, ['conversationId', 'readAt']) && uuid(value.conversationId) &&
        text(value.readAt, 40, 20) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value.readAt) &&
        Number.isFinite(Date.parse(value.readAt));
    case 'sounds:pick': case 'sounds:reset': case 'sounds:preview':
      return fields(value, ['kind']) && typeof value.kind === 'string' && KINDS.has(value.kind);
    case 'sounds:silent':
      return fields(value, ['kind', 'muted']) && typeof value.kind === 'string' && KINDS.has(value.kind) &&
        typeof value.muted === 'boolean';
    case 'sounds:previewBuiltin':
      return fields(value, ['tone']) && typeof value.tone === 'string' && TONES.has(value.tone);
    case 'calls:dial':
      return fields(value, ['conversationId', 'peerId', 'peerName']) && uuid(value.conversationId) &&
        uuid(value.peerId) && text(value.peerName, 256, 1);
    case 'calls:uiReady':return fields(value,['callId'])&&uuid(value.callId);
    case 'calls:accept': case 'calls:decline': case 'calls:end': case 'calls:route':
      return optionalCall(value);
    case 'calls:mute': return optionalCall(value, ['muted']) && typeof value.muted === 'boolean';
    case 'calls:speaker': return optionalCall(value, ['enabled']) && typeof value.enabled === 'boolean';
    case 'clipboard': return fields(value, ['text']) && text(value.text, 10000);
    case 'openExternal': return fields(value, ['url']) && httpUrl(value.url);
    case 'file:ack': return fields(value, ['id','offset']) && typeof value.id==='string' && ID.test(value.id) &&
      typeof value.offset==='number' && Number.isInteger(value.offset) && value.offset>=0 && value.offset<=32*1024*1024;
    case 'file:cancel': return fields(value, ['id']) && typeof value.id==='string' && ID.test(value.id);
    case 'files:begin': return fields(value,['name','mimeType']) && text(value.name,240,1) &&
      !/[\/\\\u0000-\u001f\u007f]/.test(value.name) && text(value.mimeType,128,3) &&
      /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(value.mimeType);
    case 'files:chunk': return fields(value,['id','data']) && uuid(value.id) && text(value.data,65536,4) &&
      value.data.length%4===0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.data);
    case 'files:end': case 'files:cancel': return fields(value,['id']) && uuid(value.id);
    case 'recordVoice:stop': return fields(value, [], ['send']) &&
      (value.send === undefined || typeof value.send === 'boolean');
    case 'migration:get': case 'bridge:ready': case 'navigation:exit': case 'notification:settings': case 'sounds:get': case 'sounds:stop': case 'recordVoice:start': case 'recordVoice:cancel': case 'recordVideo:open':
      return fields(value, []);
    default: return false;
  }
}

// React Native does not guarantee TextEncoder. Count UTF-8 without allocating
// another large buffer, including surrogate pairs and replacement characters.
function utf8WithinLimit(value: string): boolean {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length &&
      value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
    else bytes += 3;
    if (bytes > MAX_BRIDGE_BYTES) return false;
  }
  return true;
}

/** Validation is deliberately independent of native modules for unit tests.
 * Never log rejected payloads: valid session requests contain credentials.
 * The host must also deduplicate request IDs and bound concurrent operations.
 */
export function parseHybridMessage(raw: string, expectedNonce: string, sourceUrl: string): HybridMessage | null {
  if (typeof raw !== 'string' || raw.length > MAX_BRIDGE_BYTES || !NONCE.test(expectedNonce) ||
    !isTrustedHybridUrl(sourceUrl) || !utf8WithinLimit(raw)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || !fields(value, ['v', 'nonce', 'id', 'command', 'payload']) ||
      value.v !== 1 || value.nonce !== expectedNonce || typeof value.id !== 'string' || !ID.test(value.id) ||
      typeof value.command !== 'string' || !payloadValid(value.command, value.payload)) return null;
    return value as HybridMessage;
  } catch { return null; }
}
