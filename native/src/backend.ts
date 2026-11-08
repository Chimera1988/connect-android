import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const PUBLIC_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const CONNECT_URL = (process.env.EXPO_PUBLIC_CONNECT_URL || 'https://connect-chat.duckdns.org').replace(/\/$/, '');

/** All browser session data stays on the device, inside Android encrypted storage. */
const sessionStore = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

/** Keep the same REST proxy used by the working Connect PWA for restricted networks.
 * Realtime still requires native WebSocket routing; a polling fallback is used for now.
 */
function connectFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requested = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const rewritten = SUPABASE_URL && requested.startsWith(SUPABASE_URL + '/')
    ? CONNECT_URL + '/supabase/' + requested.slice(SUPABASE_URL.length + 1) : requested;
  return fetch(rewritten, init);
}

export const configured = Boolean(SUPABASE_URL && PUBLIC_KEY);
export const db = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', PUBLIC_KEY || 'not-configured', {
  auth: {
    storage: sessionStore,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { fetch: connectFetch },
});

/** Signed storage URLs are passed to native Image, bypassing global.fetch. Proxy these as well. */
export function mediaUrl(url: string) {
  return SUPABASE_URL && url.startsWith(SUPABASE_URL + '/')
    ? CONNECT_URL + '/supabase/' + url.slice(SUPABASE_URL.length + 1) : url;
}

export type Profile = {
  id: string; display_name: string; bio: string | null;
  avatar_path: string | null; is_blocked: boolean;
  online_until?: string | null; last_seen_at?: string | null;
};
export type Conversation = { id: string; user_a: string; user_b: string; created_at: string };
export type Message = {
  id: string; conversation_id: string; sender_id: string;
  body: string; created_at: string; deleted_at: string | null;
  edited_at: string | null; reply_to: string | null;
  attachment_path: string | null; attachment_name: string | null;
  attachment_type: string | null; attachment_size: number | null;
  attachment_kind: string | null;
};
export type Call = {
  id: string; conversation_id: string; caller_id: string; callee_id: string;
  status: string; created_at: string; answered_at: string | null; ended_at: string | null;
};

export const MESSAGE_COLUMNS = 'id,conversation_id,sender_id,body,created_at,deleted_at,edited_at,reply_to,attachment_path,attachment_name,attachment_type,attachment_size,attachment_kind';
