/** At-rest protection, deliberately separate from media cache and localStorage.
 * PWA keys are nonextractable Web Crypto keys in IDB (not hardware-backed).
 * Android delegates sealing to a Keystore AES-GCM key via the trusted bridge. */
const DATABASE = 'connect-secrets-v1';
let connection: Promise<IDBDatabase> | undefined;
function open() { return connection ??= new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(DATABASE, 1); r.onupgradeneeded = () => { r.result.createObjectStore('records'); r.result.createObjectStore('keys'); }; r.onsuccess = () => resolve(r.result); r.onerror = () => { connection = undefined; reject(r.error); }; }); }
async function request<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> { const d = await open(); return new Promise((resolve, reject) => { const tx = d.transaction(store, mode), r = fn(tx.objectStore(store)); let value: T; r.onsuccess = () => { value = r.result; }; tx.oncomplete = () => resolve(value); tx.onabort = tx.onerror = () => reject(tx.error || r.error); }); }
function bytes(value: Uint8Array) { return btoa(Array.from(value, x => String.fromCharCode(x)).join('')); }
function unbytes(value: string) { return Uint8Array.from(atob(value), x => x.charCodeAt(0)); }
type Sealed = {
    v: 1;
    iv: string;
    data: string;
    native?: boolean;
};
export class SecureVault {
    constructor(readonly user: string) { }
    private async key() { let key = await request<CryptoKey | undefined>('keys', 'readonly', s => s.get(this.user)); if (!key) {
        const proposed = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        try {
            await request('keys', 'readwrite', s => s.add(proposed, this.user));
            key = proposed;
        }
        catch {
            key = await request<CryptoKey>('keys', 'readonly', s => s.get(this.user));
        }
    } if (!key)
        throw Error('Ключ устройства недоступен'); return key; }
    async seal(name: string, value: unknown): Promise<Sealed> { const text = JSON.stringify(value); if (typeof window !== 'undefined' && window.ConnectNative) {
        const result = await window.ConnectNative.request('vault:seal', { name, value: text });
        return { v: 1, iv: '', data: result, native: true };
    } const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(this.user + ':' + name) }, await this.key(), new TextEncoder().encode(text)); return { v: 1, iv: bytes(iv), data: bytes(new Uint8Array(encrypted)) }; }
    async get<T>(name: string): Promise<T | undefined> { const sealed = await request<Sealed | undefined>('records', 'readonly', s => s.get(this.user + ':' + name)); if (!sealed)
        return; let text: string; if (sealed.native) {
        if (!window.ConnectNative)
            throw Error('Этот ключ защищён Android Keystore');
        text = await window.ConnectNative.request('vault:open', { name, value: sealed.data });
    }
    else {
        const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbytes(sealed.iv), additionalData: new TextEncoder().encode(this.user + ':' + name) }, await this.key(), unbytes(sealed.data));
        text = new TextDecoder().decode(raw);
    } return JSON.parse(text) as T; }
    async putMany(values: Record<string, unknown>) { const rows = await Promise.all(Object.entries(values).map(async ([name, value]) => ({ key: this.user + ':' + name, value: await this.seal(name, value) }))); const d = await open(); await new Promise<void>((resolve, reject) => { const tx = d.transaction('records', 'readwrite'); for (const row of rows)
        tx.objectStore('records').put(row.value, row.key); tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error); }); }
}
