'use client';
import { memo, useEffect, useRef, useState } from 'react';
/** Mic amplitude stays outside the chat's React render path. */
export default memo(function RecordingBar({ started, stream, onCancel, onSend }: {
    started: number;
    stream: MediaStream | null;
    onCancel: () => void;
    onSend: () => void;
}) {
    const [seconds, setSeconds] = useState(0);
    const bars = useRef<HTMLDivElement>(null);
    useEffect(() => { const update = () => setSeconds(Math.max(0, Math.floor((performance.now() - started) / 1000))); update(); const timer = setInterval(update, 100); return () => clearInterval(timer); }, [started]);
    useEffect(() => {
        let context: AudioContext | undefined, analyser: AnalyserNode | undefined, source: MediaStreamAudioSourceNode | undefined, frame = 0, last = 0, level = 0;
        const values = Array(24).fill(.07);
        const native = (event: Event) => { level = Math.max(.02, Math.min(1, Number((event as CustomEvent).detail) || 0)); };
        window.addEventListener('connect:record-level', native);
        if (stream)
            try {
                context = new AudioContext();
                analyser = context.createAnalyser();
                analyser.fftSize = 256;
                source = context.createMediaStreamSource(stream);
                source.connect(analyser);
                void context.resume().catch(() => { });
            }
            catch { /* Recording remains available if visual analysis is unavailable. */ }
        const data = new Uint8Array(256);
        const draw = (now: number) => { if (now - last >= 60) {
            last = now;
            if (analyser) {
                analyser.getByteTimeDomainData(data);
                level = Math.min(1, Math.sqrt(data.reduce((n, x) => n + ((x - 128) / 128) ** 2, 0) / data.length) * 4);
            }
            values.shift();
            values.push(Math.max(.05, level));
            bars.current?.querySelectorAll<HTMLElement>('span').forEach((bar, i) => { bar.style.transform = `scaleY(${values[i]})`; });
        } frame = requestAnimationFrame(draw); };
        frame = requestAnimationFrame(draw);
        return () => { cancelAnimationFrame(frame); source?.disconnect(); void context?.close().catch(() => { }); window.removeEventListener('connect:record-level', native); };
    }, [stream]);
    return <div className="connect-recording-bar"><div className="connect-recording-wave" ref={bars} aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <span key={i}/>)}</div><time aria-live="off">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time><button type="button" onClick={onCancel}>Отмена</button><button type="button" className="connect-recording-send" onClick={onSend}>Отправить</button></div>;
});
