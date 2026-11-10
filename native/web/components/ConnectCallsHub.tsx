'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ConnectCallAvatar, { loadCallAvatarUrls } from './ConnectCallAvatar';

type CallStatus = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'busy' | 'failed';
type Call = {
  id: string;
  conversation_id: string;
  caller_id: string;
  callee_id: string;
  status: CallStatus;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
};
type Profile = { id: string; display_name: string; is_blocked: boolean; avatar_path: string | null };
type Conversation = { id: string; user_a: string; user_b: string };
type DialContact = { conversationId: string | null; peerId: string; peerName: string };
type Filter = 'all' | 'missed';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const proxyFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const proxy = typeof window !== 'undefined' && window.location.hostname === 'connect-chat.duckdns.org';
  const target = proxy && url.startsWith(supabaseUrl + '/')
    ? window.location.origin + '/supabase/' + url.slice(supabaseUrl.length + 1)
    : url;
  return fetch(input instanceof Request ? new Request(target, input) : target, init);
};

function CallIcon({ outgoing = false, size = 24 }: { outgoing?: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.0" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.3 3.2c-.65-.6-1.4-.6-2.05-.05L2.9 4.45c-.9.85-.85 2.05-.45 3.3 2.3 6.3 6.9 10.9 13.2 13.2 1.25.4 2.45.45 3.3-.45l1.3-1.35c.55-.65.55-1.4-.05-2.05l-3.65-2.9a1.8 1.8 0 0 0-2.2.15l-1.35 1.35A15 15 0 0 1 8.3 11l1.35-1.35a1.8 1.8 0 0 0 .15-2.2Z" />
    {outgoing && <path d="m15 3 5 0 0 5m0-5-6 6" />}
  </svg>;
}
function Arrow({ outgoing }: { outgoing: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
    {outgoing ? <path d="M5 18 19 4M10 4h9v9"/> : <path d="M5 5 19 19m-9 0h9v-9"/>}
  </svg>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function callDuration(call: Call) {
  if (!call.answered_at || !call.ended_at) return '';
  const seconds = Math.max(0, Math.round((Date.parse(call.ended_at) - Date.parse(call.answered_at)) / 1000));
  const mins = Math.floor(seconds / 60);
  return `${mins}:${String(seconds % 60).padStart(2, '0')}`;
}
function missed(call: Call, self: string) {
  return call.callee_id === self && (call.status === 'missed' || call.status === 'declined' ||
    (call.status === 'ended' && !call.answered_at) ||
    (call.status === 'ringing' && Date.now() - Date.parse(call.created_at) > 60000));
}
function statusText(call: Call, self: string) {
  const outgoing = call.caller_id === self;
  const prefix = outgoing ? 'Исходящий' : 'Входящий';
  if (call.status === 'active') return prefix + ' · идёт разговор';
  if (call.status === 'ringing' && Date.now() - Date.parse(call.created_at) <= 60000) return prefix + ' · вызов';
  if (missed(call, self)) return 'Пропущенный';
  if (call.status === 'declined') return outgoing ? 'Исходящий · отклонён' : 'Отклонённый';
  if (call.status === 'busy') return prefix + ' · занято';
  if (call.status === 'failed') return prefix + ' · соединение не удалось';
  if (!call.answered_at) return prefix + ' · без ответа';
  const duration = callDuration(call);
  return `${prefix}${duration ? ' · ' + duration : ''}`;
}

/** Four-tab navigation and call history without replacing Connect's large page.tsx. */
export default function ConnectCallsHub() {
  const client = useMemo<SupabaseClient | null>(() => {
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: proxyFetch },
    });
  }, []);
  const [userId, setUserId] = useState<string | null>(null);
  const [nav, setNav] = useState<Element | null>(null);
  const [main, setMain] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [calls, setCalls] = useState<Call[]>([]);
  const [lastViewed, setLastViewed] = useState(0);
  const [names, setNames] = useState<Record<string, string>>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string,string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Journal preferences are per-account: no changes to actual call signaling or peer history.
  const [callMenuOpen, setCallMenuOpen] = useState(false);
  const [callSelecting, setCallSelecting] = useState(false);
  const [markedCalls, setMarkedCalls] = useState<string[]>([]);
  const [hiddenCallIds, setHiddenCallIds] = useState<string[]>([]);
  const [callsClearedBefore, setCallsClearedBefore] = useState<string | null>(null);
  const [callEditingBusy, setCallEditingBusy] = useState(false);
  const [callEditingError, setCallEditingError] = useState('');
  const [contacts, setContacts] = useState<DialContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const pushedRef = useRef(new Set<string>());
  const refreshGeneration = useRef(0);

  useEffect(() => {
    if (!userId) { setLastViewed(0); return; }
    const key = 'connect-last-viewed-calls:' + userId;
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && Number.isFinite(Number(stored))) setLastViewed(Number(stored));
      else { const now = Date.now(); localStorage.setItem(key, String(now)); setLastViewed(now); }
    } catch { setLastViewed(Date.now()); }
  }, [userId]);

  useEffect(() => {
    if (!client) return;
    let alive = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) setUserId(session?.user?.id || null);
    });
    void client.auth.getSession().then(({ data }) => {
      if (alive) setUserId(data.session?.user.id || null);
    }).catch(() => {});
    return () => { alive = false; subscription.unsubscribe(); };
  }, [client]);

  useEffect(() => {
    let frame = 0;
    const scan = () => {
      frame = 0;
      const shell = document.querySelector('.connect-app');
      const nextNav = shell?.querySelector('.bottom-nav') || null;
      const nextMain = shell?.querySelector('.main-view') || null;
      setNav(current => current === nextNav ? current : nextNav);
      setMain(current => current === nextMain ? current : nextMain);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    if (!nav || !main || !userId) { setOpen(false); setPickerOpen(false); }
  }, [nav, main, userId]);

  useEffect(() => {
    if (!client || !userId) {
      setHiddenCallIds([]);setCallsClearedBefore(null);setMarkedCalls([]);setCallSelecting(false);return;
    }
    let alive=true;
    void client.from('connect_call_journal_settings')
      .select('hidden_ids,cleared_before').eq('owner_id',userId).maybeSingle()
      .then(({data,error})=>{
        if (!alive)return;
        if(error){setCallEditingError('Не удалось загрузить настройки журнала: '+error.message);return;}
        setHiddenCallIds(Array.isArray(data?.hidden_ids)?data.hidden_ids:[]);
        setCallsClearedBefore(data?.cleared_before||null);
        setCallEditingError('');
      });
    return()=>{alive=false;};
  },[client,userId]);

  useEffect(()=>{
    if(!callMenuOpen)return;
    const close=(e:PointerEvent)=>{
      if(e.target instanceof Element && !e.target.closest('.connect-call-editor-menu'))setCallMenuOpen(false);
    };
    document.addEventListener('pointerdown',close);
    return()=>document.removeEventListener('pointerdown',close);
  },[callMenuOpen]);

  const refresh = useCallback(async () => {
    if (!client || !userId) return;
    const generation = ++refreshGeneration.current;
    setLoading(true);
    const { data, error: loadError } = await client.from('connect_calls')
      .select('id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at')
      .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
      .order('created_at', { ascending: false }).limit(150);
    if (generation !== refreshGeneration.current) return;
    if (loadError) {
      setError('Не удалось загрузить историю звонков.');
      setLoading(false);
      return;
    }
    setError('');
    const rows = (data || []) as Call[];
    setCalls(rows);
    const ids = Array.from(new Set(rows.map(c => c.caller_id === userId ? c.callee_id : c.caller_id)));
    if (ids.length) {
      const people = await client.from('profiles').select('id,display_name,avatar_path').in('id', ids);
      if (generation !== refreshGeneration.current) return;
      if (people.data) {
        const profiles = people.data as Profile[];
        setNames(Object.fromEntries(profiles.map(p => [p.id, p.display_name])));
        const photos = await loadCallAvatarUrls(client, profiles);
        if (generation !== refreshGeneration.current) return;
        setAvatarUrls(previous => ({...previous, ...photos}));
      }
    } else { setNames({}); setAvatarUrls({}); }
    setLoading(false);
  }, [client, userId]);

  // Match Connect's Contacts screen: all current unblocked profiles, excluding self.
  // Do not treat old conversations as an address book: blocked/deleted peers can remain
  // in historical conversations and must not appear in the new-call picker.
  const loadContacts = useCallback(async () => {
    if (!client || !userId) return;
    setContactsLoading(true); setContactsError('');
    try {
      const [peopleResult, conversationResult] = await Promise.all([
        client.from('profiles').select('id,display_name,is_blocked,avatar_path').eq('is_blocked', false).neq('id', userId).limit(250),
        client.from('conversations').select('id,user_a,user_b')
          .or(`user_a.eq.${userId},user_b.eq.${userId}`).limit(250),
      ]);
      if (peopleResult.error) throw peopleResult.error;
      if (conversationResult.error) throw conversationResult.error;
      const conversations = (conversationResult.data || []) as Conversation[];
      const chatByPeerId = new Map(conversations.map(row => [row.user_a === userId ? row.user_b : row.user_a, row.id]));
      setContacts(((peopleResult.data || []) as Profile[])
        .filter(profile => !profile.is_blocked && profile.id !== userId)
        .map(profile => ({
          conversationId: chatByPeerId.get(profile.id) || null,
          peerId: profile.id,
          peerName: profile.display_name,
        }))
        .sort((a, b) => a.peerName.localeCompare(b.peerName, 'ru')));
      const photos = await loadCallAvatarUrls(client, (peopleResult.data || []) as Profile[]);
      setAvatarUrls(previous => ({...previous, ...photos}));
    } catch {
      setContactsError('Не удалось загрузить контакты. Проверьте подключение.');
    } finally { setContactsLoading(false); }
  }, [client, userId]);

  // For an existing chat, dial immediately. For a new contact, create its
  // conversation exactly as Connect's ordinary Contacts screen does.
  const dialInProgress = useRef(false);
  async function dial(target: DialContact) {
    if (!client || !userId || target.peerId === userId || dialInProgress.current) return;
    dialInProgress.current = true;
    try {
      let conversationId = target.conversationId;
      if (!conversationId) {
        const [user_a, user_b] = [userId, target.peerId].sort();
        const { data, error: createError } = await client.from('conversations')
          .upsert({ user_a, user_b }, { onConflict: 'user_a,user_b' })
          .select('id').single();
        if (createError || !data?.id) throw createError || new Error('Не удалось открыть переписку');
        conversationId = data.id as string;
        setContacts(prev => prev.map(p => p.peerId === target.peerId ? { ...p, conversationId } : p));
      }
      setPickerOpen(false);
      window.dispatchEvent(new CustomEvent('connect:audio-call:start', {
        detail: { conversationId, peerId: target.peerId, peerName: target.peerName },
      }));
    } catch {
      setContactsError('Не удалось начать звонок. Повторите попытку.');
    } finally { dialInProgress.current = false; }
  }

  const sendCallPush = useCallback(async (call: Call) => {
    if(window.ConnectAndroid)return; // Native WebRTC controller sends the one authoritative push.
    if (!client || !userId || call.caller_id !== userId || call.status !== 'ringing') return;
    if (Date.now() - Date.parse(call.created_at) > 85000 || pushedRef.current.has(call.id)) return;
    pushedRef.current.add(call.id);
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) return;
      const response = await fetch('/api/push/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ callId: call.id }),
        cache: 'no-store',
      });
      if (!response.ok) {
        pushedRef.current.delete(call.id);
        console.warn('Connect: call push not delivered, HTTP', response.status);
      }
    } catch {
      pushedRef.current.delete(call.id);
      console.warn('Connect: call push could not reach the server');
    }
  }, [client, userId]);

  useEffect(() => {
    if (!client || !userId) return;
    let alive = true;
    const subscription = client.channel(`connect-call-history-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_calls', filter: `caller_id=eq.${userId}` }, event => {
        if (!alive) return;
        const call = event.new as Call;
        void sendCallPush(call);
        void refresh();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_calls', filter: `callee_id=eq.${userId}` }, () => { if (alive) void refresh(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'connect_calls', filter: `caller_id=eq.${userId}` }, () => { if (alive) void refresh(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'connect_calls', filter: `callee_id=eq.${userId}` }, () => { if (alive) void refresh(); })
      .subscribe();
    void refresh();

    // Fallback: the caller's button emits this event before its RPC creates the call.
    // Re-check shortly afterwards if the Realtime INSERT was missed during reconnect.
    let timers: ReturnType<typeof setTimeout>[] = [];
    const onDial = () => {
      for (const ms of [600, 1300, 2600, 4400, 7000]) {
        timers.push(setTimeout(() => {
          if (!alive) return;
          void client.from('connect_calls').select('id,conversation_id,caller_id,callee_id,status,created_at,answered_at,ended_at')
            .eq('caller_id', userId).eq('status', 'ringing')
            .gte('created_at', new Date(Date.now() - 25000).toISOString())
            .order('created_at', { ascending: false }).limit(1).maybeSingle()
            .then(({ data }) => { if (alive && data) void sendCallPush(data as Call); });
        }, ms));
      }
    };
    window.addEventListener('connect:audio-call:start', onDial);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    const onServiceWorker = (event: MessageEvent) => {
      if (event.data?.type === 'CONNECT_INCOMING_CALL') void refresh();
    };
    navigator.serviceWorker?.addEventListener('message', onServiceWorker);
    return () => {
      alive = false;
      timers.forEach(clearTimeout); timers = [];
      window.removeEventListener('connect:audio-call:start', onDial);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onServiceWorker);
      void client.removeChannel(subscription);
    };
  }, [client, userId, refresh, sendCallPush]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    function onOtherTab(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.bottom-nav .nav-tab:not(.connect-calls-tab)')) { setOpen(false); setPickerOpen(false); }
    }
    document.addEventListener('pointerdown', onOtherTab, true);
    return () => document.removeEventListener('pointerdown', onOtherTab, true);
  }, [open]);

  const visibleCalls=useMemo(()=>calls.filter(call=>
    !hiddenCallIds.includes(call.id) && (!callsClearedBefore || Date.parse(call.created_at)>Date.parse(callsClearedBefore))
  ),[calls,hiddenCallIds,callsClearedBefore]);
  const unseenMissed = userId ? visibleCalls.filter(call =>
    missed(call, userId) && Date.parse(call.ended_at || call.created_at) > lastViewed).length : 0;
  function openCalls() {
    const now = Date.now();
    setLastViewed(now);
    if (userId) try { localStorage.setItem('connect-last-viewed-calls:' + userId, String(now)); } catch {}
    setOpen(true); setFilter('all'); setCallMenuOpen(false); setCallSelecting(false); setMarkedCalls([]);
  }
  const list = filter === 'missed' && userId ? visibleCalls.filter(call => missed(call, userId)) : visibleCalls;
  const visibleContacts = contacts.filter(c => c.peerName.toLocaleLowerCase('ru-RU').includes(contactSearch.trim().toLocaleLowerCase('ru-RU')));
  function startCallSelection(){setCallMenuOpen(false);setMarkedCalls([]);setCallSelecting(true);setCallEditingError('');}
  function stopCallSelection(){setCallSelecting(false);setMarkedCalls([]);setCallMenuOpen(false);}
  function markCall(id:string,selected:boolean){setMarkedCalls(prev=>selected?Array.from(new Set([...prev,id])):prev.filter(x=>x!==id));}
  async function deleteMarkedCalls(){
    if(!client||!userId||callEditingBusy||markedCalls.length===0)return;
    if(!window.confirm(`Удалить отмеченные записи (${markedCalls.length}) только из вашего журнала?`))return;
    const nextIds=Array.from(new Set([...hiddenCallIds,...markedCalls]));
    setCallEditingBusy(true);setCallEditingError('');
    try{
      const {error}=await client.from('connect_call_journal_settings').upsert({
        owner_id:userId,hidden_ids:nextIds,cleared_before:callsClearedBefore,updated_at:new Date().toISOString(),
      },{onConflict:'owner_id'});
      if(error)throw error;
      setHiddenCallIds(nextIds);stopCallSelection();
    }catch(e){setCallEditingError('Не удалось удалить записи: '+(e instanceof Error?e.message:String(e)));}
    finally{setCallEditingBusy(false);}
  }
  async function clearCallJournal(){
    if(!client||!userId||callEditingBusy||!visibleCalls.length)return;
    setCallMenuOpen(false);
    if(!window.confirm('Очистить свой журнал вызовов? У собеседников история останется.'))return;
    const cutoff=new Date().toISOString();
    setCallEditingBusy(true);setCallEditingError('');
    try{
      const {error}=await client.from('connect_call_journal_settings').upsert({
        owner_id:userId,hidden_ids:hiddenCallIds,cleared_before:cutoff,updated_at:cutoff,
      },{onConflict:'owner_id'});
      if(error)throw error;
      setCallsClearedBefore(cutoff);stopCallSelection();
    }catch(e){setCallEditingError('Не удалось очистить журнал: '+(e instanceof Error?e.message:String(e)));}
    finally{setCallEditingBusy(false);}
  }
  return <>
    <style>{`
      .connect-app .main-view { position: relative; }
      .connect-app .bottom-nav>.connect-calls-tab { order: 2; }
      .connect-app .bottom-nav>.nav-tab:nth-child(3):not(.connect-calls-tab) { order: 3; }
      .connect-app .bottom-nav>.nav-tab:nth-child(1) { order: 0; }
      .connect-app .bottom-nav>.nav-tab:nth-child(2) { order: 1; }
      .connect-app .bottom-nav>.connect-calls-tab svg { width: 23px; height: 23px; }
      .connect-app .bottom-nav>.connect-calls-tab { position: relative; }
      .connect-app .bottom-nav .nav-symbol { position: relative; }
      .connect-app .bottom-nav .connect-nav-count {
        position: absolute; top: -8px; right: -12px; min-width: 18px; height: 18px;
        display: inline-flex; align-items: center; justify-content: center;
        padding: 0 4px; box-sizing: border-box; border-radius: 999px;
        font: 650 10px/1 system-ui, -apple-system, sans-serif; font-style: normal;
        background: color-mix(in srgb, var(--accent) 27%, #263649);
        color: var(--text); border: 1px solid color-mix(in srgb, var(--accent) 45%, rgba(215,230,250,.45));
        box-shadow: 0 1px 5px rgba(0,0,0,.22); pointer-events: none;
      }
      .connect-app:has(.connect-call-history-screen) .bottom-nav>.nav-tab.selected:not(.connect-calls-tab) {
        background: transparent !important; border-color: transparent !important; box-shadow: none !important;
        color: var(--muted) !important;
      }
      .connect-app:has(.connect-call-history-screen) .bottom-nav>.nav-tab.selected:not(.connect-calls-tab) svg { color: var(--muted) !important; filter: none !important; }
      .connect-call-history-screen {
        position: absolute; inset: 0; z-index: 3; display:flex; flex-direction:column;
        padding: 14px 5px 5px; color: var(--text); min-height: 0;
        background: color-mix(in srgb, var(--bg) 83%, transparent);
        -webkit-backdrop-filter: blur(9px); backdrop-filter: blur(9px);
      }
      .connect-call-history-head { margin: 5px 3px 17px; display:flex; align-items: center; justify-content: space-between; gap:8px; }
      .connect-call-history-head h1 { font-size: 27px; letter-spacing: -.6px; margin: 0; font-weight: 760; }
      .connect-call-history-head span { color: var(--muted); font-size: 12px; }
      .connect-call-history-head-actions { display:flex; gap:10px; align-items:center; }
      .connect-call-new, .connect-call-redial { display:grid; place-items:center; flex:0 0 auto; border:1px solid color-mix(in srgb, var(--accent) 28%, rgba(213,239,255,.19)); background:color-mix(in srgb,var(--accent) 13%,rgba(35,53,77,.61)); color:var(--accent); border-radius:14px; width:42px; height:42px; }
      .connect-call-redial { width:38px; height:38px; border-radius:13px; }
      .connect-call-new:active,.connect-call-redial:active { transform:scale(.97); }
      .connect-call-redial:disabled { opacity:.35; }
      .connect-call-history-actions { display:flex; flex:0 0 auto; align-items:center; gap:11px; }

      .connect-call-history-filters { display:flex; gap:8px; margin: 0 2px 15px; }
      .connect-call-history-filters button {
        border: 1px solid rgba(190,211,236,.12); border-radius: 999px; padding: 9px 16px;
        background: rgba(32,46,66,.53); color: var(--text); font-size: 12px;
      }
      .connect-call-history-filters button[aria-pressed="true"] {
        color:#fff; border-color: color-mix(in srgb, var(--accent) 45%, transparent);
        background:color-mix(in srgb, var(--accent) 60%, #202d43);
      }
      .connect-call-history-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 18px; -webkit-overflow-scrolling: touch; }
      .connect-call-history-item { display: flex; align-items:center; gap: 12px; padding: 14px 12px; min-height: 76px;
        border-bottom: 1px solid rgba(180,208,237,.12); }
      .connect-call-history-list { border: 1px solid rgba(180,208,237,.13); background:rgba(20,31,48,.55);
        border-radius: 22px; overflow: hidden; box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
      .connect-call-history-item:last-child { border-bottom: none; }
      .connect-call-history-avatar { width: 46px; height: 46px; flex:0 0 46px; display:flex;align-items:center;justify-content:center;
        border-radius: 50%; background: color-mix(in srgb, var(--accent) 24%, #22334b); color:var(--text); font-weight:700;font-size:20px; }
      .connect-call-history-details { min-width:0; flex:1; display:flex;flex-direction:column;gap:5px; }
      .connect-call-history-details strong { font-size:15px; overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .connect-call-history-details small { display:flex;align-items:center;gap:5px;color:var(--muted);font-size:12px; }
      .connect-call-history-details small.missed { color: #ff8392; }
      .connect-call-history-date { flex:0 0 auto; display:flex;flex-direction:column;align-items:flex-end;gap:5px;color:var(--muted);font-size:11px; }
      .connect-call-history-empty { margin: 65px 12px; text-align:center;color:var(--muted);font-size:14px;line-height:1.5; }
      .connect-call-history-empty button { margin-top:15px; border:0; border-radius:12px; background:var(--accent); color:white; padding:11px 20px; }
      .connect-call-picker-scrim { position:absolute; inset:0; z-index:8; display:flex; flex-direction:column; justify-content:flex-end; background:rgba(2,7,15,.55); -webkit-backdrop-filter:blur(5px); backdrop-filter:blur(5px); }
      .connect-call-picker { max-height:min(75%,650px); display:flex; flex-direction:column; padding:17px 16px max(19px,env(safe-area-inset-bottom)); background:linear-gradient(145deg,rgba(35,55,78,.98),rgba(15,25,43,.99)); border-radius:27px 27px 0 0; border:1px solid rgba(218,236,255,.2); box-shadow:0 -18px 45px rgba(0,0,0,.34); }
      .connect-call-picker-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:15px; }
      .connect-call-picker-head strong { font-size:19px; }
      .connect-call-picker-head button { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.1); border-radius:12px; color:var(--text); padding:8px 12px; }
      .connect-call-picker input { color:var(--text); background:rgba(10,20,34,.53); border:1px solid rgba(225,244,255,.17); border-radius:17px; padding:12px 13px; margin-bottom:10px; font-size:15px; outline-offset:2px; }
      .connect-call-picker-list { flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; }
      .connect-call-picker-person { display:flex; width:100%; align-items:center; gap:11px; padding:12px 4px; background:transparent; color:var(--text); border:0; border-bottom:1px solid rgba(200,222,255,.10); text-align:left; font-size:15px; }
      .connect-call-picker-person span:nth-child(2) { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .connect-call-picker-person .connect-call-history-avatar { width:40px;height:40px;flex-basis:40px;font-size:17px; }
      .connect-call-picker-empty { color:var(--muted); padding:18px 5px; text-align:center; font-size:13px; }

      @media(max-width:370px) { .connect-call-history-item {padding-inline:9px;gap:9px;} .connect-call-history-avatar{width:40px;height:40px;flex-basis:40px;} .connect-call-history-date{font-size:10px;} }
    `}</style>
    {nav && main && userId && createPortal(<button type="button" className={'nav-tab connect-calls-tab' + (open ? ' selected' : '')}
      aria-label={unseenMissed ? `Звонки: пропущенных ${unseenMissed}` : "Звонки"} aria-pressed={open} onClick={openCalls}>
      <span className="nav-symbol"><CallIcon />{unseenMissed > 0 && <span className="connect-nav-count" aria-hidden="true">{unseenMissed > 99 ? '99+' : unseenMissed}</span>}</span><small>Звонки</small>
    </button>, nav)}
    {main && nav && userId && open && createPortal(<section className={"connect-call-history-screen"+(callSelecting?" is-selecting":"")} aria-label="История звонков">
      <div className="connect-call-history-head"><h1>Звонки</h1><div className="connect-call-history-head-actions"><span>{visibleCalls.length} записей</span><button type="button" className="connect-call-new" aria-label="Позвонить контакту" title="Новый звонок" onClick={() => { setCallMenuOpen(false);setContactSearch(''); setPickerOpen(true); void loadContacts(); }}><CallIcon size={22}/></button><div className="connect-call-editor-menu"><button type="button" className="connect-call-editor-more" aria-label="Действия с журналом вызовов" aria-expanded={callMenuOpen} onClick={()=>setCallMenuOpen(!callMenuOpen)}>•••</button>{callMenuOpen && <div className="connect-call-editor-popup" role="menu"><button type="button" role="menuitem" disabled={callEditingBusy} onClick={startCallSelection}>Выбрать</button><button type="button" role="menuitem" disabled={callEditingBusy||!visibleCalls.length} onClick={startCallSelection}>Удалить…</button><button type="button" role="menuitem" className="danger" disabled={callEditingBusy||!visibleCalls.length} onClick={()=>void clearCallJournal()}>Очистить журнал</button></div>}</div></div></div>
      {callEditingError && <div role="alert" className="connect-call-editor-error">{callEditingError}</div>}
      {callSelecting && <div className="connect-call-editor-toolbar"><button type="button" onClick={stopCallSelection}>Отмена</button><span>Выбрано: {markedCalls.length}</span><button type="button" onClick={()=>setMarkedCalls(list.map(c=>c.id))} disabled={callEditingBusy||!list.length}>Выбрать все</button><button type="button" className="danger" disabled={callEditingBusy||!markedCalls.length} onClick={()=>void deleteMarkedCalls()}>Удалить ({markedCalls.length})</button></div>}
      <div className="connect-call-history-filters">
        <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все</button>
        <button type="button" aria-pressed={filter === 'missed'} onClick={() => setFilter('missed')}>Пропущенные</button>
      </div>
      <div className="connect-call-history-scroll">
        {error ? <div className="connect-call-history-empty" role="alert">{error}<div><button type="button" onClick={() => void refresh()}>Повторить</button></div></div> :
          list.length === 0 ? <div className="connect-call-history-empty">{loading ? 'Загружаем звонки…' : filter === 'missed' ? 'Пропущенных звонков нет' : 'Звонков пока нет'}</div> :
          <div className="connect-call-history-list">{list.map(call => {
            const outgoing = call.caller_id === userId;
            const peerId = outgoing ? call.callee_id : call.caller_id;
            const displayName = names[peerId] || 'Собеседник';
            const missedCall = missed(call, userId);
            return <div className="connect-call-history-item" key={call.id}>
              {callSelecting && <input type="checkbox" className="connect-call-editor-check" aria-label={`Выбрать звонок: ${displayName}, ${formatTime(call.created_at)}`} checked={markedCalls.includes(call.id)} onChange={e=>markCall(call.id,e.currentTarget.checked)}/>}
              <ConnectCallAvatar className="connect-call-history-avatar" name={displayName} url={avatarUrls[peerId]}/>
              <div className="connect-call-history-details"><strong>{displayName}</strong><small className={missedCall ? 'missed' : ''}><Arrow outgoing={outgoing}/>{statusText(call,userId)}</small></div>
              <div className="connect-call-history-actions"><div className="connect-call-history-date"><time dateTime={call.created_at}>{formatDate(call.created_at)}</time><span>{formatTime(call.created_at)}</span></div><button type="button" className="connect-call-redial" title={`Позвонить: ${displayName}`} aria-label={`Позвонить: ${displayName}`} disabled={call.status === 'ringing' || call.status === 'active'} onClick={() => void dial({ conversationId:call.conversation_id, peerId, peerName:displayName })}><CallIcon size={19}/></button></div>
            </div>;
          })}</div>}
      </div>
      {pickerOpen && <div className="connect-call-picker-scrim" role="dialog" aria-modal="true" aria-label="Новый аудиозвонок" onPointerDown={event => { if (event.target === event.currentTarget) setPickerOpen(false); }}>
        <div className="connect-call-picker">
          <div className="connect-call-picker-head"><strong>Кому позвонить?</strong><button type="button" onClick={() => setPickerOpen(false)}>Закрыть</button></div>
          <input aria-label="Найти контакт" placeholder="Поиск контакта" value={contactSearch} onChange={event => setContactSearch(event.target.value)}/>
          <div className="connect-call-picker-list">{contactsError ? <div className="connect-call-picker-empty" role="alert">{contactsError}<div><button type="button" onClick={() => void loadContacts()}>Повторить</button></div></div> : contactsLoading ? <div className="connect-call-picker-empty">Загружаем контакты…</div> : visibleContacts.length ? visibleContacts.map(contact => <button type="button" className="connect-call-picker-person" key={contact.conversationId} onClick={() => void dial(contact)}><ConnectCallAvatar className="connect-call-history-avatar" name={contact.peerName} url={avatarUrls[contact.peerId]}/><span>{contact.peerName}</span><CallIcon size={20}/></button>) : <div className="connect-call-picker-empty">{contactSearch ? 'Ничего не найдено' : 'Контактов пока нет'}</div>}</div>
        </div>
      </div>}
    </section>, main)}
  </>;
}
