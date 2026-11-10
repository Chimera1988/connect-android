'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import ConnectCallAvatar, { loadCallAvatarUrls } from './ConnectCallAvatar';
import { traceCall } from '../lib/call-diagnostics';

type Status = 'ringing' | 'active' | 'ended' | 'declined' | 'missed' | 'busy' | 'failed';
type CallRow = {
  id: string; conversation_id: string; caller_id: string; callee_id: string;
  status: Status; offer: RTCSessionDescriptionInit; answer: RTCSessionDescriptionInit | null;
  created_at: string; answered_at: string | null; ended_at: string | null;
};
type IceRow = { id: number; call_id: string; sender_id: string; candidate: RTCIceCandidateInit };
type Phase = 'idle' | 'preparing' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'reconnecting';
// A contact chosen directly from the Calls tab, not inferred from a chat title.
type OutgoingTarget = { conversationId: string; peerId: string; peerName: string };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = {
  client: SupabaseClient | null;
  userId: string | null;
  conversationId: string | null;
  peerId: string | null;
  peerName: string;
};

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const RING_TIMEOUT_MS = 50000;
const isLive = (s: Status) => s === 'ringing' || s === 'active';
const friendlyError = (e: unknown) => e instanceof Error ? e.message : 'Неизвестная ошибка';
const initials = (name: string) => name.trim().slice(0, 1).toLocaleUpperCase('ru-RU') || '☎';

function Glyph({ name }: { name: 'call' | 'end' | 'mic' | 'muted' | 'speaker' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: name === 'call' ? 2.0 : 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths = {
    call: <path d="M6.3 3.2c-.65-.6-1.4-.6-2.05-.05L2.9 4.45c-.9.85-.85 2.05-.45 3.3 2.3 6.3 6.9 10.9 13.2 13.2 1.25.4 2.45.45 3.3-.45l1.3-1.35c.55-.65.55-1.4-.05-2.05l-3.65-2.9a1.8 1.8 0 0 0-2.2.15l-1.35 1.35A15 15 0 0 1 8.3 11l1.35-1.35a1.8 1.8 0 0 0 .15-2.2Z"/>,
    end: <><path d="M3.5 12c4.4-4.3 12.6-4.3 17 0"/><path d="M5.4 10.4 3 14.2m15.6-3.8 2.4 3.8"/></>,
    mic: <><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></>,
    muted: <><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8M3 3l18 18"/></>,
    speaker: <><path d="M4 9v6h4l5 4V5L8 9zM17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name]}</svg>;
}

/** A real button rendered beside the three-dot menu in the chat header. */
export function ConnectCallButton({ peerName, disabled = false }: { peerName: string; disabled?: boolean }) {
  return <button className="connect-call-trigger" type="button"
    aria-label={`Позвонить: ${peerName}`} title="Аудиозвонок" disabled={disabled}
    onClick={() => window.dispatchEvent(new Event('connect:audio-call:start'))}>
    <Glyph name="call"/>
  </button>;
}


/**
 * Lightweight synthesized call sounds. No media files, no microphone access.
 * Incoming and ringback repeat while their phase is on screen; the connection
 * chime is played only when the WebRTC peer actually reaches "connected".
 * WebKit may block unsolicited playback until the user has tapped the PWA.
 */
type RingTone = 'incoming' | 'ringback';
class ConnectCallSound {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private repeating: ReturnType<typeof setInterval> | null = null;
  private current: RingTone | null = null;
  private lastPatternAt = -Infinity;

  unlock() {
    if (typeof window === 'undefined') return;
    if (!this.context) {
      try { this.context = new window.AudioContext(); }
      catch { return; }
    }
    const context = this.context;
    if (context.state === 'running') {
      this.playCycle();
      return;
    }
    void context.resume().then(() => {
      if (this.context === context) this.playCycle();
    }).catch(() => { /* iOS requires a user gesture to allow sound. */ });
  }

  private beep(bus: GainNode, frequency: number, delay: number, length: number, volume: number) {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    const t = context.currentTime + delay;
    const osc = context.createOscillator();
    const envelope = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, t);
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(volume, t + Math.min(.025, length / 4));
    envelope.gain.setValueAtTime(volume, t + Math.max(.035, length - .065));
    envelope.gain.linearRampToValueAtTime(0, t + length);
    osc.connect(envelope);
    envelope.connect(bus);
    osc.start(t);
    osc.stop(t + length + .02);
    osc.onended = () => { osc.disconnect(); envelope.disconnect(); };
  }

  private makeOutput(): GainNode | null {
    if (!this.context || this.context.state !== 'running') return null;
    const output = this.context.createGain();
    output.gain.value = .8;
    output.connect(this.context.destination);
    return output;
  }

  private playCycle() {
    if (!this.current || !this.context || this.context.state !== 'running') return;
    if (this.context.currentTime - this.lastPatternAt < 1.6) return;
    if (!this.output) this.output = this.makeOutput();
    if (!this.output) return;
    this.lastPatternAt = this.context.currentTime;
    if (this.current === 'incoming') {
      // Gentle three-note Connect ringtone, approximately every 3.4 seconds.
      this.beep(this.output, 659.25, 0, .21, .075);
      this.beep(this.output, 880, .27, .23, .068);
      this.beep(this.output, 783.99, .59, .35, .073);
    } else {
      // Familiar paired ringback pulses (locally generated, not live call audio).
      for (const start of [0, .64]) {
        this.beep(this.output, 440, start, .45, .046);
        this.beep(this.output, 480, start, .45, .037);
      }
    }
  }

  start(mode: RingTone) {
    if (this.current === mode) return;
    this.stop();
    this.current = mode;
    this.lastPatternAt = -Infinity;
    this.unlock();
    this.repeating = setInterval(() => this.playCycle(), mode === 'incoming' ? 3400 : 3600);
  }

  stop() {
    this.current = null;
    if (this.repeating) clearInterval(this.repeating);
    this.repeating = null;
    if (this.output) {
      const output = this.output;
      this.output = null;
      if (this.context && this.context.state !== 'closed') {
        const t = this.context.currentTime;
        output.gain.cancelScheduledValues(t);
        output.gain.setValueAtTime(output.gain.value, t);
        output.gain.linearRampToValueAtTime(0, t + .035);
      }
      setTimeout(() => { try { output.disconnect(); } catch { /* Already detached. */ } }, 100);
    }
  }

  connected() {
    this.stop();
    this.unlock();
    const output = this.makeOutput();
    if (!output) return;
    // Short rising confirmation chime; never repeat during an active call.
    this.beep(output, 740, 0, .12, .055);
    this.beep(output, 988, .12, .19, .060);
    setTimeout(() => { try { output.disconnect(); } catch { /* Unmounted. */ } }, 500);
  }

  close() {
    this.stop();
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}

export default function ConnectAudioCalls({ client, userId, conversationId, peerId, peerName }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [shown, setShown] = useState<CallRow | null>(null);
  const [shownName, setShownName] = useState('');
  const [shownPeerId, setShownPeerId] = useState<string | null>(null);
  const [shownAvatarUrl, setShownAvatarUrl] = useState('');
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callRef = useRef<CallRow | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const iceChannelRef = useRef<RealtimeChannel | null>(null);
  const localIceRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteIceRef = useRef<RTCIceCandidateInit[]>([]);
  const knownIceRef = useRef<Set<number>>(new Set());
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const answerPendingRef = useRef(false);
  // localDescription grows as ICE is gathered. Compare the immutable SDP that
  // won the server's answer transaction, never the mutable browser snapshot.
  const submittedAnswerRef = useRef<RTCSessionDescriptionInit | null>(null);
  const outgoingPendingRef = useRef(false);
  const enteredRef = useRef(false);
  const syncingRef = useRef(false);
  const iceSyncingRef = useRef(false);
  const iceSendingRef = useRef(false);
  const remoteIceCursorRef = useRef(0);
  const transportTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missedCheckedRef = useRef(false);
  // A single sound engine is kept for this component's lifetime.
  const soundRef = useRef<ConnectCallSound | null>(null);
  if (!soundRef.current) soundRef.current = new ConnectCallSound();

  // The call modal may open from the chat, the Calls tab, or an incoming call.
  // Resolve its image from the actual peer ID rather than guessing by display name.
  useEffect(() => {
    let active = true;
    setShownAvatarUrl('');
    if (client && shownPeerId) {
      void Promise.resolve(client.from('profiles').select('avatar_path').eq('id', shownPeerId).maybeSingle())
        .then(async ({data}) => {
          if (!active || !data?.avatar_path) return;
          const photos = await loadCallAvatarUrls(client, [{id:shownPeerId, avatar_path:data.avatar_path}]);
          if (active) setShownAvatarUrl(photos[shownPeerId] || '');
        }).catch(() => {});
    }
    return () => { active = false; };
  }, [client, shownPeerId]);

  useEffect(() => {
    // iPhone Safari/PWA generally needs an explicit gesture to unlock audio.
    // This does not request or activate the microphone.
    const unlock = () => soundRef.current?.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      soundRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (phase === 'incoming') {
      // Android uses the selected native NotificationChannel sound; avoid a second browser ringtone.
      if (window.ConnectAndroid) soundRef.current?.stop();
      else soundRef.current?.start('incoming');
    }
    else if (phase === 'ringing') soundRef.current?.start('ringback');
    else soundRef.current?.stop();
  }, [phase]);


  async function getIceServers(): Promise<RTCIceServer[]> {
    if (!client) return STUN;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    try {
      const { data } = await client.auth.getSession();
      if (!data.session?.access_token) return STUN;
      const response = await fetch('/api/calls/ice', {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {traceCall(callRef.current?.id,'ice-config','fallback','HTTP_'+response.status);return STUN;}
      const body = await response.json();
      const servers:RTCIceServer[]=Array.isArray(body.iceServers)&&body.iceServers.length?body.iceServers:STUN;
      const relay=servers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)));
      traceCall(callRef.current?.id,'ice-config','ready',relay?'TURN':'STUN_ONLY');
      return servers;
    } catch { traceCall(callRef.current?.id,'ice-config','fallback','NETWORK');return STUN; }
    finally {clearTimeout(timeout);}
  }

  async function sendIce(candidate: RTCIceCandidateInit) {
    localIceRef.current.push(candidate);
    await flushLocalIce();
  }

  async function flushLocalIce() {
    const call=callRef.current,generation=generationRef.current;
    if(!client||!userId||!call||!isLive(call.status)||iceSendingRef.current)return;
    iceSendingRef.current=true;
    try{
      while(localIceRef.current.length&&generation===generationRef.current&&callRef.current?.id===call.id){
        const candidate=localIceRef.current[0];
        const {error}=await client.from('connect_call_ice').insert({call_id:call.id,sender_id:userId,candidate});
        if(error){traceCall(call.id,'ice-send','retry','HTTP_ERROR');return;}
        if(generation!==generationRef.current)return;
        if(localIceRef.current[0]===candidate)localIceRef.current.shift();
      }
    }catch{traceCall(call.id,'ice-send','retry','NETWORK');}
    finally{if(generation===generationRef.current)iceSendingRef.current=false;}
  }

  async function flushRemoteIce() {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    const queued = remoteIceRef.current.splice(0);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* A stale candidate can be ignored. */ }
    }
  }

  async function receiveIce(ice: IceRow) {
    if (!userId || ice.sender_id === userId || !callRef.current || ice.call_id !== callRef.current.id) return;
    if (knownIceRef.current.has(ice.id)) return;
    knownIceRef.current.add(ice.id);
    const pc = pcRef.current;
    if (!pc?.remoteDescription) { remoteIceRef.current.push(ice.candidate); return; }
    try { await pc.addIceCandidate(ice.candidate); }
    catch { /* A withdrawn candidate is non-fatal. */ }
  }

  // Postgres Realtime is an optimization, not a guarantee. On a reconnect its
  // INSERT event may be dropped; resync ICE from the authoritative table.
  async function pullIce() {
    const call = callRef.current;
    if (!client || !call || !pcRef.current || iceSyncingRef.current) return;
    const generation=generationRef.current;
    iceSyncingRef.current = true;
    try {
      for(let page=0;page<4;page++){
        const { data, error } = await client.from('connect_call_ice')
          .select('id,call_id,sender_id,candidate').eq('call_id', call.id)
          .neq('sender_id',userId).gt('id',remoteIceCursorRef.current).order('id', { ascending: true }).limit(250);
        if(error||!data||callRef.current?.id!==call.id||generation!==generationRef.current)return;
        for(const candidate of data){await receiveIce(candidate as IceRow);if(generation!==generationRef.current)return;remoteIceCursorRef.current=Math.max(remoteIceCursorRef.current,candidate.id);}
        if(data.length<250)break;
      }
    } catch { /* A transient fetch failure is retried on the next sync. */ }
    finally { if(generation===generationRef.current)iceSyncingRef.current = false; }
  }

  function watchIce(callId: string) {
    if (!client) return;
    if (iceChannelRef.current) void client.removeChannel(iceChannelRef.current);
    knownIceRef.current = new Set();
    remoteIceCursorRef.current = 0;
    const channel = client.channel(`connect-call-ice-${callId}-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_call_ice', filter: `call_id=eq.${callId}` },
        payload => { void receiveIce(payload.new as IceRow); })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void pullIce();
      });
    iceChannelRef.current = channel;
    void pullIce();
  }

  function cleanup() {
    window.ConnectAndroid?.setSpeakerphone(false);
    if (callRef.current) window.ConnectAndroid?.setCallState(callRef.current.id, 'ended');
    setSpeakerOn(false);
    soundRef.current?.stop();
    generationRef.current++;
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    ringTimeoutRef.current = null;
    if(transportTimeoutRef.current)clearTimeout(transportTimeoutRef.current);
    transportTimeoutRef.current=null;
    if (iceChannelRef.current && client) void client.removeChannel(iceChannelRef.current);
    iceChannelRef.current = null;
    pcRef.current?.close(); pcRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (remoteAudioRef.current) { remoteAudioRef.current.pause(); remoteAudioRef.current.srcObject = null; }
    callRef.current = null;
    localIceRef.current = [];
    remoteIceRef.current = [];
    knownIceRef.current = new Set();
    iceSendingRef.current=false;iceSyncingRef.current=false;remoteIceCursorRef.current=0;
    answerPendingRef.current = false;
    submittedAnswerRef.current = null;
    outgoingPendingRef.current = false;
    enteredRef.current = false;
    setShown(null); setShownPeerId(null); setShownAvatarUrl(''); setPhase('idle'); setElapsed(0); setMuted(false);
  }

  async function notifyCallEnded(callId: string) {
    if (!client) return;
    try {
      const { data: { session } } = await client.auth.getSession();
      if (!session) return;
      const response = await fetch('/api/push/call/end', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ callId }),
      });
      if (!response.ok) console.warn('Connect: call-end push HTTP', response.status);
    } catch {
      console.warn('Connect: call-end push could not reach the server');
    }
  }

  async function finish(reason: 'hangup' | 'decline' | 'missed' | 'failed' | 'busy' = 'hangup') {
    const current = callRef.current;
    const acceptedHere=current?.status==='active'&&!!submittedAnswerRef.current?.sdp&&current.answer?.sdp===submittedAnswerRef.current.sdp;
    const wireReason=current?.callee_id===userId&&!acceptedHere?'decline':reason;
    traceCall(current?.id,'finish','ended',reason);
    cleanup();
    if (current && client) {
      const { error: rpcError } = await client.rpc('connect_finish_audio_call', {
        p_call_id: current.id, p_reason: wireReason,
      });
      if (rpcError) console.warn('Connect call state:', rpcError.message);
      else void notifyCallEnded(current.id);
    }
  }

  function connectionDeadline(pc:RTCPeerConnection,generation:number,ms=25000){
    if(transportTimeoutRef.current)clearTimeout(transportTimeoutRef.current);
    transportTimeoutRef.current=setTimeout(()=>{
      if(generation!==generationRef.current||pcRef.current!==pc||pc.connectionState==='connected')return;
      traceCall(callRef.current?.id,'transport','failed','TIMEOUT');
      setToast('Не удалось соединить звонок. Проверьте интернет и повторите вызов.');void finish('failed');
    },ms);
  }

  async function createPeer(): Promise<RTCPeerConnection> {
    const generation = generationRef.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('Для звонков нужен современный браузер с доступом к микрофону и HTTPS.');
    }
    // On iOS request microphone access inside the original tap handler, before
    // waiting for the TURN configuration over the network.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false });
    let iceServers: RTCIceServer[];
    try {
      if (generation !== generationRef.current) throw new Error('Звонок уже завершён');
      iceServers = await getIceServers();
      if (generation !== generationRef.current) throw new Error('Звонок уже завершён');
    } catch (error) {
      // A permission/TURN response from an old call owns only its own stream.
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }
    let pc: RTCPeerConnection;
    try { pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' }); }
    catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
    streamRef.current = stream;
    pcRef.current = pc;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const ownsPeer = () => generation === generationRef.current && pcRef.current === pc;
    pc.oniceconnectionstatechange=()=>{if(ownsPeer())traceCall(callRef.current?.id,'ice',pc.iceConnectionState);};
    pc.onicecandidate = event => { if (ownsPeer() && event.candidate) void sendIce(event.candidate.toJSON()); };
    pc.ontrack = event => {
      if (!ownsPeer()) return;
      const audio = remoteAudioRef.current;
      if (!audio) return;
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      void audio.play().catch(() => { if (ownsPeer()) setError('Нажмите «Звук», чтобы включить собеседника.'); });
    };
    pc.onconnectionstatechange = () => {
      if (!ownsPeer()) return;
      traceCall(callRef.current?.id,'transport',pc.connectionState);
      if (pc.connectionState === 'connected') { if (!enteredRef.current) soundRef.current?.connected(); enteredRef.current = true; if (callRef.current) window.ConnectAndroid?.setCallState(callRef.current.id, 'active'); setPhase('active'); setError(''); }
      if(pc.connectionState==='connected'&&transportTimeoutRef.current){clearTimeout(transportTimeoutRef.current);transportTimeoutRef.current=null;}
      if(pc.connectionState==='disconnected'&&enteredRef.current){setPhase('reconnecting');connectionDeadline(pc,generation,20000);}
      if (pc.connectionState === 'failed') { setToast('Связь прервалась. Для некоторых сетей необходим TURN-сервер.'); void finish('failed'); }
    };
    return pc;
  }

  async function onUpdatedCall(next: CallRow) {
    const current = callRef.current;
    if (!current || current.id !== next.id) return;
    // The first accepted SDP identifies the receiving device. Other devices
    // release local ringing without finishing the conversation on the server.
    if (next.status === 'active' && next.callee_id === userId &&
        (!submittedAnswerRef.current?.sdp || next.answer?.sdp !== submittedAnswerRef.current.sdp)) {
      cleanup();
      traceCall(next.id,'answer-owner','released','OTHER_DEVICE');
      setToast('Звонок принят на другом устройстве');
      return;
    }
    callRef.current = next;
    setShown(next);
    if (!isLive(next.status)) {
      void notifyCallEnded(next.id);
      if (next.status === 'missed' && next.callee_id === userId) setToast(`Пропущенный звонок: ${shownName || 'собеседник'}`);
      else if (next.status === 'declined') setToast('Звонок отклонён');
      else if (next.status === 'busy') setToast('Собеседник занят');
      cleanup();
      return;
    }
    if (next.status === 'active' && next.caller_id === userId && next.answer && pcRef.current && !answerPendingRef.current) {
      const pc = pcRef.current;
      const generation = generationRef.current;
      if (pc.remoteDescription) return;
      answerPendingRef.current = true;
      connectionDeadline(pc,generation);
      try {
        await pc.setRemoteDescription(next.answer);
        if (generation !== generationRef.current || pcRef.current !== pc) return;
        await flushRemoteIce();
        if (generation === generationRef.current && pcRef.current === pc && pc.connectionState!=='connected') setPhase('connecting');
      }
      catch (e) {
        if (generation !== generationRef.current || pcRef.current !== pc) return;
        setError(`Не удалось установить соединение: ${friendlyError(e)}`); void finish('failed');
      }
      finally { if (generation === generationRef.current) answerPendingRef.current = false; }
    }
  }

  function presentIncoming(row: CallRow) {
    if (!userId || row.callee_id !== userId || callRef.current || outgoingPendingRef.current) return;
    if (row.status !== 'ringing' || Date.now() - Date.parse(row.created_at) > 59000) return;
    callRef.current = row; setShown(row); setShownName('Собеседник'); setShownPeerId(row.caller_id); setPhase('incoming'); setError('');
    if (client) {
      void client.from('profiles').select('display_name').eq('id', row.caller_id).maybeSingle()
        .then(({ data }) => { if (callRef.current?.id === row.id && data?.display_name) setShownName(data.display_name); });
    }
    ringTimeoutRef.current = setTimeout(() => {
      if (callRef.current?.id === row.id && callRef.current?.status === 'ringing') cleanup();
    }, Math.max(1000, RING_TIMEOUT_MS - (Date.now() - Date.parse(row.created_at))));
  }

  useEffect(() => {
    if (!client || !userId) { cleanup(); return; }
    let active = true;
    missedCheckedRef.current = false;
    const inbox = client.channel(`connect-calls-inbox-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_calls', filter: `callee_id=eq.${userId}` },
        payload => { if (active) { presentIncoming(payload.new as CallRow); void refreshIncoming(); } })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'connect_calls', filter: `caller_id=eq.${userId}` },
        payload => { if (active) void onUpdatedCall(payload.new as CallRow); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'connect_calls', filter: `callee_id=eq.${userId}` },
        payload => { if (active) void onUpdatedCall(payload.new as CallRow); })
      .subscribe(status => { if (status === 'SUBSCRIBED') void refreshIncoming(); });

    async function refreshIncoming() {
      if (!active || !client || !userId || syncingRef.current) return;
      syncingRef.current = true;
      try {
        const existing = callRef.current;
        if (existing) {
          const { data } = await client.from('connect_calls').select('*')
            .eq('id', existing.id).maybeSingle();
          if (active && data) await onUpdatedCall(data as CallRow);
        } else {
          const { data } = await client.from('connect_calls').select('*')
            .eq('callee_id', userId).eq('status', 'ringing')
            .gte('created_at', new Date(Date.now() - 59000).toISOString())
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (active && data) presentIncoming(data as CallRow);
          if (active && !data && !callRef.current && !missedCheckedRef.current) {
            missedCheckedRef.current = true;
            const { data: lastMissed } = await client.from('connect_calls')
              .select('id').eq('callee_id', userId).eq('status', 'missed')
              .gte('created_at', new Date(Date.now() - 86400000).toISOString())
              .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (active && lastMissed?.id) {
              const key = 'connect-last-missed-audio-call:' + userId;
              try {
                if (localStorage.getItem(key) !== lastMissed.id) {
                  localStorage.setItem(key, lastMissed.id);
                  setToast('Пропущенный аудиозвонок');
                }
              } catch { /* Persistent storage may be unavailable. */ }
            }
          }
        }
        if (active && callRef.current && pcRef.current) {await flushLocalIce();await pullIce();}
      } catch { /* Realtime or the next poll will retry transient errors. */ }
      finally { syncingRef.current = false; }
    }
    function visible() { if (document.visibilityState === 'visible') void refreshIncoming(); }
    function fromPush(event: MessageEvent) {
      if (event.data?.type === 'CONNECT_INCOMING_CALL') void refreshIncoming();
    }
    // WebKit can suspend the websocket while the PWA is backgrounded, and
    // a Realtime event can be missed when resuming. Re-fetch while visible.
    const poll = setInterval(visible, 2400);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    window.addEventListener('pageshow', visible);
    navigator.serviceWorker?.addEventListener('message', fromPush);
    void refreshIncoming();
    return () => {
      active = false;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
      window.removeEventListener('pageshow', visible);
      navigator.serviceWorker?.removeEventListener('message', fromPush);
      void client.removeChannel(inbox);
      cleanup();
    };
    // Subscription lifetime depends only on user identity, not on selected tab/chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId]);

  useEffect(() => {
    if (phase !== 'active' && phase !== 'reconnecting') return;
    const started = Date.parse(shown?.answered_at || '') || Date.now();
    const id = setInterval(() => setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))), 1000);
    return () => clearInterval(id);
  }, [phase, shown?.answered_at]);

  async function notifyIncoming(callId:string,generation:number){
    if(!client)return;
    for(let attempt=0;attempt<3;attempt++){
      if(generation!==generationRef.current||callRef.current?.id!==callId||callRef.current.status!=='ringing')return;
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),6000);
      try{
        const {data:{session}}=await client.auth.getSession();if(!session)return;
        const response=await fetch('/api/push/call',{method:'POST',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({callId})});
        const result=response.ok?await response.json():null;
        if(result&&(result.sent>0||result.duplicate||result.ignored)){traceCall(callId,'push','accepted');return;}
        traceCall(callId,'push','retry','HTTP_'+response.status);
      }catch{traceCall(callId,'push','retry','NETWORK');}finally{clearTimeout(timeout);}
      if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));
    }
  }

  async function startOutgoing(target?: OutgoingTarget) {
    const selectedConversation = target?.conversationId || conversationId;
    const selectedPeer = target?.peerId || peerId;
    const selectedName = target?.peerName || peerName;
    if (!client || !userId || !selectedConversation || !selectedPeer ||
        !uuidPattern.test(selectedConversation) || !uuidPattern.test(selectedPeer) ||
        selectedPeer === userId || callRef.current || phase !== 'idle' || outgoingPendingRef.current) return;
    outgoingPendingRef.current = true;
    soundRef.current?.unlock();
    const generation = ++generationRef.current;
    setShownName(selectedName); setShownPeerId(selectedPeer); setError(''); setToast(''); setPhase('preparing');
    try {
      const pc = await createPeer();
      if (generation !== generationRef.current) { pc.close(); return; }
      const offer = await pc.createOffer();
      if (generation !== generationRef.current || pcRef.current !== pc) return;
      await pc.setLocalDescription(offer);
      if (generation !== generationRef.current || pcRef.current !== pc) return;
      const { data, error: rpcError } = await client.rpc('connect_start_audio_call', {
        p_conversation_id: selectedConversation, p_offer: pc.localDescription?.toJSON(),
      });
      if (rpcError || !data) throw new Error(rpcError?.message || 'Не удалось начать звонок');
      const row = data as CallRow;
      if (generation !== generationRef.current) {
        await client.rpc('connect_finish_audio_call', { p_call_id: row.id, p_reason: 'hangup' });
        return;
      }
      callRef.current = row; setShown(row); setPhase('ringing');
      traceCall(row.id,'start','ringing');
      // Push directly from the call controller. The Calls tab also retains its
      // Realtime fallback; the server deduplicates both attempts by call ID.
      void notifyIncoming(row.id,generation);
      watchIce(row.id); await flushLocalIce();
      if (generation !== generationRef.current) return;
      ringTimeoutRef.current = setTimeout(() => {
        if (callRef.current?.id === row.id && callRef.current?.status === 'ringing') {
          setToast('Нет ответа'); void finish('missed');
        }
      }, RING_TIMEOUT_MS);
      // Catch an answer that arrived before the caller's subscription was ready.
      const { data: latest } = await client.from('connect_calls').select('*').eq('id', row.id).maybeSingle();
      if (latest) void onUpdatedCall(latest as CallRow);
    } catch (e) {
      if (generation !== generationRef.current) return;
      const msg = friendlyError(e);
      const failed = callRef.current;
      cleanup();
      if (failed) void client.rpc('connect_finish_audio_call', { p_call_id: failed.id, p_reason: 'failed' });
      setToast(msg.includes('duplicate key') ? 'В этом чате уже идёт звонок' : `Звонок не начат: ${msg}`);
    }
  }

  // The explicit button above emits this event; it no longer depends on DOM queries.
  // The call controller stays mounted for incoming calls even outside a conversation.
  useEffect(() => {
    const onStart = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as Partial<OutgoingTarget> | null : null;
      const target = detail && typeof detail.conversationId === 'string' &&
        typeof detail.peerId === 'string' && typeof detail.peerName === 'string'
        ? detail as OutgoingTarget : undefined;
      void startOutgoing(target);
    };
    window.addEventListener('connect:audio-call:start', onStart);
    return () => window.removeEventListener('connect:audio-call:start', onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, userId, conversationId, peerId, peerName, phase]);

  async function acceptIncoming() {
    const row = callRef.current;
    if (!row || !client || row.status !== 'ringing' || phase !== 'incoming' || answerPendingRef.current) return;
    answerPendingRef.current = true;
    soundRef.current?.unlock();
    const generation = generationRef.current;
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    setError(''); setPhase('connecting');
    try {
      const pc = await createPeer();
      if (generation !== generationRef.current) { pc.close(); return; }
      connectionDeadline(pc,generation);
      watchIce(row.id);
      await pc.setRemoteDescription(row.offer);
      if (generation !== generationRef.current || pcRef.current !== pc) return;
      await flushRemoteIce();
      if (generation !== generationRef.current || pcRef.current !== pc) return;
      const answer = await pc.createAnswer();
      if (generation !== generationRef.current || pcRef.current !== pc) return;
      await pc.setLocalDescription(answer);
      if (generation !== generationRef.current || pcRef.current !== pc) return;
      const submitted = pc.localDescription?.toJSON();
      if (!submitted?.sdp) throw new Error('Не удалось подготовить аудиоответ');
      submittedAnswerRef.current = submitted;
      traceCall(row.id,'answer','submitting');
      const { data, error: rpcError } = await client.rpc('connect_answer_audio_call', {
        p_call_id: row.id, p_answer: submitted,
      });
      if (rpcError || !data) throw new Error(rpcError?.message || 'Звонок уже завершён');
      if (generation !== generationRef.current) {
        // The accepted RPC may complete after a local cancel. Finish that ID,
        // without touching a new call's microphone, state or timers.
        await client.rpc('connect_finish_audio_call', { p_call_id: row.id, p_reason: 'hangup' });
        return;
      }
      callRef.current = data as CallRow; setShown(data as CallRow);
      await flushLocalIce();
    } catch (e) {
      if (generation !== generationRef.current) return;
      setToast(`Не удалось принять звонок: ${friendlyError(e)}`);
      const acceptedHere = callRef.current?.status === 'active' &&
        !!submittedAnswerRef.current?.sdp && callRef.current.answer?.sdp === submittedAnswerRef.current.sdp;
      // A losing device must not hang up a call already accepted elsewhere.
      // The matching server guard ignores a late decline of an active call.
      void finish(acceptedHere ? 'failed' : 'decline');
    } finally {
      if (generation === generationRef.current) answerPendingRef.current = false;
    }
  }

  function toggleMute() {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next; });
    setMuted(next);
  }
  function enableRemoteAudio() {
    if (window.ConnectAndroid) {
      const next=!speakerOn;
      window.ConnectAndroid.setSpeakerphone(next);
      setSpeakerOn(next);
    }
    void remoteAudioRef.current?.play().then(() => setError('')).catch(() => setError('Не удалось включить звук. Проверьте настройки воспроизведения.'));
  }

  // Notification action intents are delivered before or after React mounts.
  // Execute them only for the matching, still-ringing call, never another caller.
  useEffect(() => {
    function handleAndroidAction() {
      const action=window.__connectAndroidPendingCall;
      if(!action || !callRef.current || action.callId!==callRef.current.id || phase!=='incoming') return;
      delete window.__connectAndroidPendingCall;
      if(action.action==='accept') void acceptIncoming();
      else if(action.action==='decline') void finish('decline');
    }
    handleAndroidAction();
    const poll=window.setInterval(handleAndroidAction,350);
    window.addEventListener('connect:android-call-action',handleAndroidAction);
    return ()=>{window.clearInterval(poll);window.removeEventListener('connect:android-call-action',handleAndroidAction);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[phase,shown?.id]);

  const calling = phase !== 'idle';
  const incoming = phase === 'incoming';
  const phaseTitle: Record<Phase, string> = {
    idle: '', preparing: 'Подключаем микрофон…', ringing: 'Вызываем…', incoming: 'Входящий аудиозвонок',
    connecting: 'Соединяем…', active: `Разговор · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`,
    reconnecting: 'Восстанавливаем соединение…',
  };

  return <>
    {calling && <div className="connect-call-backdrop" role="dialog" aria-modal="true" aria-label="Аудиозвонок Connect">
      <div className="connect-call-modal">
        <p className="connect-call-eyebrow">CONNECT · АУДИО</p>
        <ConnectCallAvatar className="connect-call-avatar" name={shownName || 'Собеседник'} url={shownAvatarUrl}/>
        <h2>{shownName || 'Собеседник'}</h2>
        <p className="connect-call-info" role="status">{phaseTitle[phase]}</p>
        <div className="connect-call-actions">
          {incoming && <button className="connect-call-action accept" type="button" onClick={() => void acceptIncoming()}>
            <span><Glyph name="call"/></span><span>Принять</span>
          </button>}
          {!incoming && (phase === 'active' || phase === 'connecting' || phase === 'reconnecting') && <button className={'connect-call-action' + (muted ? ' muted' : '')}
            type="button" onClick={toggleMute}><span><Glyph name={muted ? 'muted' : 'mic'}/></span><span>{muted ? 'Включить микрофон' : 'Выключить микрофон'}</span></button>}
          {!incoming && <button className="connect-call-action" type="button" onClick={enableRemoteAudio}>
            <span><Glyph name="speaker"/></span><span>{window.ConnectAndroid ? speakerOn ? 'Обычный звук' : 'Громкая связь' : 'Звук'}</span>
          </button>}
          <button className="connect-call-action hangup" type="button"
            onClick={() => void finish(incoming ? 'decline' : 'hangup')}>
            <span><Glyph name="end"/></span><span>{incoming ? 'Отклонить' : 'Завершить'}</span>
          </button>
        </div>
        {error && <p className="connect-call-error" role="alert">{error}</p>}
        <p className="connect-call-note">Звонки работают при открытой PWA. В фоне iPhone может отключить микрофон.</p>
      </div>
    </div>}
    <audio ref={remoteAudioRef} className="connect-call-audio" autoPlay/>
    {!calling && toast && <button className="connect-call-missed" type="button" onClick={() => setToast('')} role="status">{toast} · Закрыть</button>}
  </>;
}
