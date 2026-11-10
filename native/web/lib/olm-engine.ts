/** Olm primitive adapter. Not activated for production conversations: device
 * enrollment, linking, history quorum and authenticated call signaling must be
 * reviewed and deployed together before enabling the protocol capability. */
import nacl from 'tweetnacl';
export const SECURE_PROTOCOL = 1;
export type Device = {
    v: 1;
    user: string;
    id: string;
    curve25519: string;
    ed25519: string;
    prekey: string;
    signature: string;
};
export type Packet = {
    v: 1;
    conversation: string;
    message: string;
    sender: string;
    recipient: string;
    session: string;
    type: number;
    body: string;
    signature: string;
};
type Account = {
    identityKeys(): string;
    generateOneTimeKeys(n: number): void;
    oneTimeKeys(): string;
    sign(s: string): string;
    pickle(): string;
    createOutboundSession(k: string, o: string): Session;
    createInboundSession(body: string): {
        senderIdentityKey: string;
        plaintext: string;
        takeSession(): Session;
    };
};
type Session = {
    sessionId(): string;
    encrypt(s: string): string;
    decrypt(t: number, b: string): string;
    pickle(): string;
};
type Olm = {
    Account: {
        new (): Account;
        fromPickle(s: string): Account;
    };
    Session: {
        fromPickle(s: string): Session;
    };
    default: (options: unknown) => Promise<unknown>;
};
type Store = {
    get<T>(key: string): Promise<T | undefined>;
    putMany(values: Record<string, unknown>): Promise<void>;
};
const text = new TextEncoder();
const encode = (a: Uint8Array) => btoa(Array.from(a, x => String.fromCharCode(x)).join(''));
const decode = (s: string) => Uint8Array.from(atob(s), x => x.charCodeAt(0));
const canonicalDevice = (d: Omit<Device, 'signature'>) => JSON.stringify([d.v, d.user, d.id, d.curve25519, d.ed25519, d.prekey]);
const canonicalPacket = (p: Omit<Packet, 'signature'>) => JSON.stringify([p.v, p.conversation, p.message, p.sender, p.recipient, p.session, p.type, p.body]);
export function verifyDevice(d: Device) { try {
    return d.v === 1 && nacl.sign.detached.verify(text.encode(canonicalDevice(d)), decode(d.signature), decode(d.ed25519));
}
catch {
    return false;
} }
export async function fingerprint(d: Device) { const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', text.encode(JSON.stringify([d.user, d.curve25519, d.ed25519])))); return Array.from(hash, x => x.toString(16).padStart(2, '0')).join('').match(/.{1,4}/g)!.join(' '); }
export class OlmEngine {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private olm: Olm, private store: Store, readonly user: string, readonly device: string) { }
    private exclusive<T>(fn: () => Promise<T>): Promise<T> { const operation = async () => { if (typeof navigator !== 'undefined' && navigator.locks)
        return await navigator.locks.request('connect-olm:' + this.user + ':' + this.device, fn); throw Error('Защищённая отправка требует межвкладочной блокировки хранилища'); }; const next = this.queue.then(operation, operation); this.queue = next.catch(() => { }); return next; }
    async initialize() { return this.exclusive(async () => { let saved = await this.store.get<string>('account'); let a = saved ? this.olm.Account.fromPickle(saved) : new this.olm.Account(); let descriptor = await this.store.get<Device>('descriptor'); if (descriptor)
        return descriptor; a.generateOneTimeKeys(20); const keys = JSON.parse(a.identityKeys()), prekeys = JSON.parse(a.oneTimeKeys()).curve25519; const d = { v: 1 as const, user: this.user, id: this.device, ...keys, prekey: Object.values(prekeys)[0] as string }; descriptor = { ...d, signature: a.sign(canonicalDevice(d)) }; await this.store.putMany({ account: a.pickle(), descriptor }); return descriptor; }); }
    /** Explicit user comparison required; receiving an unrecognized public key does not pin it. */
    async trust(d: Device, comparedFingerprint: string) { if (!verifyDevice(d) || await fingerprint(d) !== comparedFingerprint)
        throw Error('Отпечаток устройства не совпадает'); await this.store.putMany({ ['trust:' + d.user + ':' + d.id]: [d.curve25519, d.ed25519] }); }
    private async assertTrusted(d: Device) { const pin = await this.store.get<string[]>('trust:' + d.user + ':' + d.id); if (!verifyDevice(d) || !pin || pin[0] !== d.curve25519 || pin[1] !== d.ed25519)
        throw Error('Ключ собеседника не подтверждён или изменился. Проверьте отпечатки.'); }
    async encrypt(conversation: string, message: string, content: unknown, devices: Device[]) { return this.exclusive(async () => { if (!devices.length || devices.length > 16)
        throw Error('Нет доступных доверенных устройств'); const old = await this.store.get<{
        conversation: string;
        packets: Packet[];
    }>('outbox:' + message); if (old) {
        if (old.conversation !== conversation)
            throw Error('Идентификатор сообщения уже использован');
        return old.packets;
    } const pickle = await this.store.get<string>('account'); if (!pickle)
        throw Error('Секретный ключ устройства недоступен'); const a = this.olm.Account.fromPickle(pickle), updates: Record<string, unknown> = {}, packets: Packet[] = []; for (const d of devices) {
        await this.assertTrusted(d);
        const key = 'session:' + d.user + ':' + d.id;
        const previous = await this.store.get<string>(key);
        const session = previous ? this.olm.Session.fromPickle(previous) : a.createOutboundSession(d.curve25519, d.prekey);
        const ciphertext = JSON.parse(session.encrypt(JSON.stringify({ v: 1, conversation, message, sender: this.device, recipient: d.id, content })));
        const p = { v: 1 as const, conversation, message, sender: this.device, recipient: d.id, session: session.sessionId(), type: ciphertext.type, body: ciphertext.body };
        packets.push({ ...p, signature: a.sign(canonicalPacket(p)) });
        updates[key] = session.pickle();
    } updates.account = a.pickle(); updates['outbox:' + message] = { conversation, packets }; updates['history:' + message] = { conversation, content }; await this.store.putMany(updates); return packets; }); }
    async decrypt(p: Packet, d: Device, conversation: string, message: string) { return this.exclusive(async () => { await this.assertTrusted(d); if (p.v !== 1 || p.conversation !== conversation || p.message !== message || p.sender !== d.id || p.recipient !== this.device || ![0, 1].includes(p.type) || !nacl.sign.detached.verify(text.encode(canonicalPacket(p)), decode(p.signature), decode(d.ed25519)))
        throw Error('Подпись или адресат сообщения не совпадает'); const history = await this.store.get<{
        conversation: string;
        content: unknown;
        packet?: string;
    }>('history:' + message); if (history) {
        if (history.conversation !== conversation || history.packet !== canonicalPacket(p))
            throw Error('Повторный идентификатор сообщения');
        return history.content;
    } const pickle = await this.store.get<string>('account'); if (!pickle)
        throw Error('История недоступна без ключей доверенного устройства'); const account = this.olm.Account.fromPickle(pickle), key = 'session:' + d.user + ':' + d.id, old = await this.store.get<string>(key); let session: Session, plain: string; if (old) {
        session = this.olm.Session.fromPickle(old);
        if (session.sessionId() !== p.session)
            throw Error('Сессия изменилась. Требуется подтверждённое обновление ключей');
        plain = session.decrypt(p.type, p.body);
    }
    else {
        if (p.type !== 0)
            throw Error('Нет ключа сессии');
        const inbound = account.createInboundSession(p.body);
        if (inbound.senderIdentityKey !== d.curve25519)
            throw Error('Подмена ключа отправителя');
        session = inbound.takeSession();
        plain = inbound.plaintext;
        if (session.sessionId() !== p.session)
            throw Error('Сессия не совпадает');
    } const value = JSON.parse(plain); if (value.v !== 1 || value.conversation !== conversation || value.message !== message || value.sender !== d.id || value.recipient !== this.device)
        throw Error('Повреждённый контекст сообщения'); await this.store.putMany({ account: account.pickle(), [key]: session.pickle(), ['history:' + message]: { conversation, content: value.content, packet: canonicalPacket(p) } }); return value.content; }); }
}
let modulePromise: Promise<Olm> | undefined;
export function loadOlm(base = '/connect-crypto/') { return modulePromise ??= (async () => { const path = base + 'olm.js'; const module = await import(/* webpackIgnore: true */ /* @vite-ignore */ path) as Olm; await module.default({ module_or_path: await (await fetch(base + 'olm.wasm')).arrayBuffer() }); return module; })(); }
/** Standard one-use AES-256-GCM media envelope. All descriptive metadata belongs
 * inside the Olm payload; random media key and nonce are never uploaded in clear. */
export async function encryptMedia(file: Blob, context: string) { if (file.size > 100 * 1024 ** 2)
    throw Error('Зашифрованное вложение превышает 100 МБ'); const raw = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12)), key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']); const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(context) }, key, await file.arrayBuffer()); return { ciphertext: new Blob([data], { type: 'application/octet-stream' }), secret: { v: 1, key: encode(raw), iv: encode(iv), context } }; }
export async function decryptMedia(blob: Blob, secret: {
    v: number;
    key: string;
    iv: string;
    context: string;
}, context: string) { if (secret.v !== 1 || secret.context !== context || blob.size > 100 * 1024 ** 2 + 16)
    throw Error('Неверный контекст вложения'); const key = await crypto.subtle.importKey('raw', decode(secret.key), 'AES-GCM', false, ['decrypt']); return new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(secret.iv), additionalData: text.encode(context) }, key, await blob.arrayBuffer())]); }
