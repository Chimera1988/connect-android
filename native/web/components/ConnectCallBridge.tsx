'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ConnectCallButton } from './ConnectAudioCalls';
import ConnectAudioCalls from '../hybrid/NativeCallSurface';

type ChatMatch = { conversationId: string; peerId: string; peerName: string };
type ConversationRow = { id: string; user_a: string; user_b: string };
type ProfileRow = { id: string; display_name: string };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

// Use the same Supabase project and local auth session as Connect's main client.
// The alternate DuckDNS domain uses the same HTTP proxy as app/page.tsx.
const bridgeFetch: typeof fetch = (input, init) => {
  const original = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const shouldProxy = typeof window !== 'undefined' && window.location.hostname === 'connect-chat.duckdns.org';
  const target = shouldProxy && original.startsWith(supabaseUrl + '/')
    ? window.location.origin + '/supabase/' + original.slice(supabaseUrl.length + 1)
    : original;
  return fetch(input instanceof Request ? new Request(target, input) : target, init);
};

function readChatHeader(): { root: Element | null; header: Element | null; name: string } {
  const root = document.querySelector('.connect-app');
  const header = root?.querySelector('.chat-view .chat-header') || null;
  const name = header?.querySelector('.chat-header-person strong')?.textContent?.trim() || '';
  return { root, header, name };
}

export default function ConnectCallBridge() {
  const client = useMemo<SupabaseClient | null>(() => {
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: bridgeFetch },
    });
  }, []);
  const [userId, setUserId] = useState<string | null>(null);
  const [appRoot, setAppRoot] = useState<Element | null>(null);
  const [header, setHeader] = useState<Element | null>(null);
  const [headerName, setHeaderName] = useState('');
  const [chat, setChat] = useState<ChatMatch | null>(null);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) setUserId(session?.user?.id || null);
    });
    void client.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user.id || null);
    }).catch(() => { if (alive) setUserId(null); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    // React controls the chat screen. Observe it rather than editing its DOM;
    // the call button itself is a normal React portal, not an injected HTML string.
    let frame = 0;
    function refresh() {
      frame = 0;
      const next = readChatHeader();
      setAppRoot(prev => prev === next.root ? prev : next.root);
      setHeader(prev => prev === next.header ? prev : next.header);
      setHeaderName(prev => prev === next.name ? prev : next.name);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(refresh);
    }
    refresh();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('visibilitychange', schedule);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    setChat(null);
    if (!client || !userId || !headerName) return;
    let alive = true;
    async function resolve() {
      if (!client || !userId) return;
      const { data: conversations, error: listError } = await client
        .from('conversations').select('id,user_a,user_b')
        .or(`user_a.eq.${userId},user_b.eq.${userId}`).limit(250);
      if (!alive || listError || !conversations?.length) return;
      const rows = conversations as ConversationRow[];
      const peers = Array.from(new Set(rows.map(row => row.user_a === userId ? row.user_b : row.user_a)));
      if (!peers.length) return;
      const { data: profiles, error: peopleError } = await client
        .from('profiles').select('id,display_name').in('id', peers);
      if (!alive || peopleError || !profiles) return;
      const matchingProfiles = (profiles as ProfileRow[])
        .filter(profile => profile.display_name.trim() === headerName);
      // Never guess the recipient when two contacts share a display name.
      if (matchingProfiles.length !== 1) return;
      const person = matchingProfiles[0];
      const matches = rows.filter(row => row.user_a === person.id || row.user_b === person.id);
      if (matches.length !== 1) return;
      setChat({ conversationId: matches[0].id, peerId: person.id, peerName: person.display_name });
    }
    void resolve();
    return () => { alive = false; };
  }, [client, userId, headerName]);

  return <>
    {appRoot && createPortal(
      <ConnectAudioCalls
        client={client}
        userId={userId}
        conversationId={header && chat ? chat.conversationId : null}
        peerId={header && chat ? chat.peerId : null}
        peerName={chat?.peerName || headerName || 'Собеседник'}
      />,
      appRoot,
    )}
    {header && userId && createPortal(
      <ConnectCallButton peerName={headerName} disabled={!chat || !client} />,
      header,
    )}
  </>;
}
