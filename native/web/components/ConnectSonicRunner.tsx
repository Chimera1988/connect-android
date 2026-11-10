'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A self-contained retro Sonic-themed jump runner for Connect.
 * No network calls, audio permissions, microphone access, external art or libraries.
 * We attach only the settings shortcut and the game screen; messaging stays untouched.
 */

type EnemyKind = 'motobug' | 'crabmeat' | 'buzzbomber';
type Enemy = { id: number; kind: EnemyKind; x: number; w: number; h: number; altitude: number };
type Ring = { id: number; x: number; y: number; taken: boolean };
type Mode = 'ready' | 'running' | 'over';
type Game = {
  elapsed: number;
  score: number;
  ringsCollected: number;
  speed: number;
  jumpOffset: number;
  jumpVelocity: number;
  nextObstacle: number;
  enemies: Enemy[];
  rings: Ring[];
  nextId: number;
};

const BEST_KEY = 'connect-sonic-runner-best-v1';
const PLAYER_X = 57;

function newGame(): Game {
  return {
    elapsed: 0, score: 0, ringsCollected: 0, speed: 175,
    jumpOffset: 0, jumpVelocity: 0, nextObstacle: 1.35,
    enemies: [], rings: [], nextId: 1,
  };
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

function pixel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, scale = 2.1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x * scale), Math.round(y * scale), Math.ceil(w * scale), Math.ceil(h * scale));
}

function sonic(ctx: CanvasRenderingContext2D, x: number, ground: number, jumpOffset: number, tick: number) {
  const s = 2.05;
  const foot = ground + jumpOffset;
  const blue = '#1468ea', deep = '#0843a7', ice = '#52b3ff', skin = '#f0ad73';
  ctx.save();
  ctx.translate(Math.round(x), Math.round(foot - 57));
  // Quills: instantly recognisable blue spikes on a hand-drawn pixel sprite.
  pixel(ctx, 1, 9, 10, 4, deep, s);
  pixel(ctx, 3, 6, 12, 4, blue, s);
  pixel(ctx, 0, 13, 12, 3, blue, s);
  pixel(ctx, 6, 3, 12, 4, blue, s);
  pixel(ctx, 10, 1, 9, 4, deep, s);
  pixel(ctx, 15, 4, 7, 5, blue, s);
  pixel(ctx, 18, 8, 5, 8, blue, s);
  pixel(ctx, 4, 11, 18, 9, blue, s);
  pixel(ctx, 9, 16, 13, 6, skin, s);
  pixel(ctx, 14, 7, 5, 9, '#f9f5e8', s);
  pixel(ctx, 17, 9, 2, 6, '#19885b', s);
  pixel(ctx, 18, 11, 1.5, 4, '#102a3e', s);
  pixel(ctx, 19, 17, 3, 2, '#181822', s); // nose
  pixel(ctx, 8, 21, 12, 3, blue, s);
  pixel(ctx, 4, 22, 6, 5, '#f9f5e8', s); // glove
  pixel(ctx, 16, 22, 5, 5, '#f9f5e8', s);
  const run = Math.floor(tick * 12) % 2;
  const leg = jumpOffset < -6 ? 0 : run * 2;
  pixel(ctx, 7 + leg, 24, 6, 4, blue, s);
  pixel(ctx, 15 - leg, 24, 5, 4, blue, s);
  pixel(ctx, 4 + leg, 27, 11, 2, '#e22e3c', s);
  pixel(ctx, 12 - leg, 28, 11, 2, '#e22e3c', s);
  pixel(ctx, 4 + leg, 28, 11, 1, '#f9f9ff', s);
  pixel(ctx, 12 - leg, 29, 11, 1, '#f9f9ff', s);
  pixel(ctx, 5 + leg, 26, 6, 1, '#f9f9ff', s);
  pixel(ctx, 13 - leg, 27, 6, 1, '#f9f9ff', s);
  pixel(ctx, 9, 4, 7, 2, ice, s);
  ctx.restore();
}

// Low Buzz Bombers must be jumped; high ones are safe to run underneath.
// A tiny hover movement is shared by drawing and collision detection.
function enemyAltitude(enemy: Enemy, seconds: number): number {
  return enemy.kind === 'buzzbomber'
    ? enemy.altitude + Math.sin(seconds * 5.2 + enemy.id) * 2.5
    : 0;
}

function badnik(ctx: CanvasRenderingContext2D, enemy: Enemy, ground: number, seconds: number) {
  ctx.save();
  const altitude = enemyAltitude(enemy, seconds);
  ctx.translate(Math.round(enemy.x), Math.round(ground - enemy.h - altitude));
  const w = enemy.w, h = enemy.h;
  const move = Math.floor(seconds * 7) % 2;
  if (enemy.kind === 'motobug') {
    // Motobug-style red beetle robot.
    pixel(ctx, 1, 8, 14, 7, '#b7192f');
    pixel(ctx, 3, 5, 10, 4, '#ef3946');
    pixel(ctx, 5, 3, 6, 2, '#ff6871');
    pixel(ctx, 13, 9, 4, 4, '#c8d9ec');
    pixel(ctx, 14, 10, 2, 2, '#1b222e');
    pixel(ctx, 3, 15, 4, 4, '#273d58');
    pixel(ctx, 11, 15, 4, 4, '#273d58');
    pixel(ctx, 4, 16, 2, 2, '#91aec9');
    pixel(ctx, 12, 16, 2, 2, '#91aec9');
    pixel(ctx, 6, 11, 1, 2, '#a02026');
  } else if (enemy.kind === 'crabmeat') {
    // Crabmeat-style clawed Badnik.
    pixel(ctx, 4, 10, 11, 7, '#e93e3d');
    pixel(ctx, 5, 7, 9, 4, '#ff7360');
    pixel(ctx, 6, 6, 2, 4, '#f3f7fa');
    pixel(ctx, 11, 6, 2, 4, '#f3f7fa');
    pixel(ctx, 6, 8, 1, 2, '#17293c');
    pixel(ctx, 11, 8, 1, 2, '#17293c');
    pixel(ctx, 1, 4, 2, 8, '#d92638');
    pixel(ctx, 16, 4, 2, 8, '#d92638');
    pixel(ctx, 0, 3, 4, 5, '#ff5a48');
    pixel(ctx, 15, 3, 4, 5, '#ff5a48');
    pixel(ctx, 2, 18 + move, 3, 2, '#647f9c');
    pixel(ctx, 13, 18 - move, 3, 2, '#647f9c');
    pixel(ctx, 5, 17, 3, 2, '#647f9c');
    pixel(ctx, 11, 17, 3, 2, '#647f9c');
  } else {
    // Buzz Bomber-style hovering wasp robot, flying low to be jumped over.
    pixel(ctx, 4, 8, 12, 8, '#e8b735');
    pixel(ctx, 3, 9, 3, 6, '#2d3948');
    pixel(ctx, 10, 9, 3, 6, '#222c40');
    pixel(ctx, 15, 10, 4, 5, '#d3e9ef');
    pixel(ctx, 16, 11, 2, 2, '#c72e3a');
    pixel(ctx, 6, 3 - move, 5, 6, '#9fd6f4');
    pixel(ctx, 10, 4 + move, 5, 5, '#b9e7fb');
    pixel(ctx, 1, 13, 4, 2, '#58718d');
    pixel(ctx, 9, 16, 2, 4, '#343d4e');
    pixel(ctx, 8, 20, 4, 2, '#e33c48');
  }
  ctx.restore();
  // A faint ground shadow also shows the position of hovering robots.
  ctx.fillStyle = enemy.kind === 'buzzbomber' ? '#28363722' : '#28363755';
  ctx.fillRect(Math.round(enemy.x + 5), Math.round(ground + 1), Math.max(12, w - 9), 3);
}

function ringSprite(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const spin = 0.65 + Math.abs(Math.sin(time * 6)) * .35;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(spin, 1);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#8e5604';
  ctx.beginPath(); ctx.ellipse(0, 0, 8, 10, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ffd83b';
  ctx.beginPath(); ctx.ellipse(0, 0, 7, 9, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff6a8'; ctx.fillRect(-2, -10, 4, 3);
  ctx.restore();
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, game: Game, mode: Mode) {
  const ground = h - 59;
  const dt = game.elapsed;
  // Retro Green-Hill-like world, original canvas geometry and pixel sprites.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#73d4fa'); sky.addColorStop(.67, '#a5f0fc'); sky.addColorStop(1, '#d6f9d3');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
  // Horizontal atmosphere stripes.
  ctx.fillStyle = '#ffffff22';
  for (let y = 24; y < ground - 50; y += 44) ctx.fillRect(0, y, w, 2);
  const cloudStep = 175;
  const cloudOffset = (dt * 13) % cloudStep;
  for (let x = -cloudStep - cloudOffset; x < w + cloudStep; x += cloudStep) {
    rounded(ctx, x + 35, 52, 92, 13, 7, '#f4ffffcf');
    rounded(ctx, x + 49, 37, 61, 21, 11, '#f4ffffe8');
    rounded(ctx, x + 67, 28, 29, 19, 10, '#ffffffd6');
  }
  const farOffset = dt * 19 % 190;
  for (let x = -190 - farOffset; x < w + 200; x += 190) {
    ctx.fillStyle = '#8ccd89';
    ctx.beginPath(); ctx.ellipse(x + 88, ground + 13, 95, 97, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#74b675';
    ctx.beginPath(); ctx.ellipse(x + 157, ground + 22, 78, 65, 0, Math.PI, 0); ctx.fill();
  }
  // Bright grass top / iconic checkerboard earth.
  ctx.fillStyle = '#28b54d'; ctx.fillRect(0, ground - 6, w, 10);
  ctx.fillStyle = '#83e75f'; ctx.fillRect(0, ground - 8, w, 3);
  ctx.fillStyle = '#87552a'; ctx.fillRect(0, ground + 4, w, h - ground);
  const tile = 20, offset = (dt * game.speed * .75) % (tile * 2);
  for (let x = -tile * 2 - offset; x < w + tile * 2; x += tile) {
    for (let y = ground + 6; y < h; y += tile) {
      const parity = (Math.round((x + offset) / tile) + Math.round((y - ground - 6) / tile)) & 1;
      ctx.fillStyle = parity ? '#ba7637' : '#9e622d';
      ctx.fillRect(Math.floor(x), y, tile, tile);
      ctx.fillStyle = '#d18a492e'; ctx.fillRect(Math.floor(x), y, tile, 3);
    }
  }
  for (const ring of game.rings) if (!ring.taken) ringSprite(ctx, ring.x, ring.y, game.elapsed);
  for (const enemy of game.enemies) badnik(ctx, enemy, ground, game.elapsed);
  // Sprite shadow changes with jump height.
  const shadowOffset = Math.abs(game.jumpOffset);
  rounded(ctx, PLAYER_X + 13 - Math.min(shadowOffset * .12, 8), ground + 1, 30 + Math.min(shadowOffset * .2, 16), 3, 1, '#182c3155');
  sonic(ctx, PLAYER_X, ground, game.jumpOffset, game.elapsed);
  if (mode !== 'running' && mode !== 'over') {
    ctx.fillStyle = '#09203811'; ctx.fillRect(0, 0, w, h);
  }
}

export default function ConnectSonicRunner() {
  const [menu, setMenu] = useState<Element | null>(null);
  const [main, setMain] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('ready');
  const [score, setScore] = useState(0);
  const [rings, setRings] = useState(0);
  const [best, setBest] = useState(0);
  const game = useRef<Game>(newGame());
  const modeRef = useRef<Mode>('ready');
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const hudAt = useRef(0);
  const bestRef = useRef(0);

  useEffect(() => {
    let frame = 0;
    function scan() {
      frame = 0;
      const shell = document.querySelector('.connect-app');
      const root = shell?.querySelector('.main-view') || null;
      const settings = root?.querySelector('.settings-content .settings-menu') || null;
      setMenu(current => current === settings ? current : settings);
      setMain(current => current === root ? current : root);
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(scan); };
    scan();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => { if (open && !menu) setOpen(false); }, [open, menu]);

  const finish = useCallback(() => {
    if (modeRef.current !== 'running') return;
    modeRef.current = 'over'; setMode('over');
    const final = game.current.score;
    if (final > bestRef.current) {
      bestRef.current = final;
      setBest(final);
      try { localStorage.setItem(BEST_KEY, String(final)); } catch { /* Storage disabled. */ }
    }
    setScore(final);
    setRings(game.current.ringsCollected);
  }, []);

  const start = useCallback(() => {
    game.current = newGame();
    modeRef.current = 'running'; setMode('running');
    setScore(0); setRings(0); hudAt.current = 0;
  }, []);

  const jump = useCallback(() => {
    if (modeRef.current !== 'running') { start(); return; }
    const state = game.current;
    if (state.jumpOffset >= -2 && state.jumpVelocity >= 0) state.jumpVelocity = -580;
  }, [start]);

  const openGame = () => {
    try {
      const stored = Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0);
      bestRef.current = Math.floor(stored); setBest(bestRef.current);
    } catch { bestRef.current = 0; setBest(0); }
    game.current = newGame();
    modeRef.current = 'ready'; setMode('ready'); setScore(0); setRings(0);
    setOpen(true);
  };

  const closeGame = () => { setOpen(false); modeRef.current = 'ready'; };

  useEffect(() => {
    if (!open) return;
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const gameContext = ctx;
    let width = 320, height = 320, request = 0, previous = 0;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      width = Math.max(260, rect.width); height = Math.max(260, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.round(width * ratio); el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    resize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(el);
    window.addEventListener('resize', resize);
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault();
        if (!event.repeat) jump();
      } else if (event.key === 'Escape') closeGame();
    };
    document.addEventListener('keydown', onKey);

    function step(time: number) {
      const delta = previous ? Math.min((time - previous) / 1000, .034) : 0;
      previous = time;
      const g = game.current;
      if (modeRef.current === 'running' && document.visibilityState === 'visible') {
        g.elapsed += delta;
        g.speed = Math.min(355, 175 + g.elapsed * 4.5);
        g.jumpVelocity += 1620 * delta;
        g.jumpOffset = Math.min(0, g.jumpOffset + g.jumpVelocity * delta);
        if (g.jumpOffset === 0 && g.jumpVelocity > 0) g.jumpVelocity = 0;
        g.nextObstacle -= delta;
        if (g.nextObstacle <= 0) {
          const types: EnemyKind[] = ['motobug', 'crabmeat', 'buzzbomber'];
          const kind = types[Math.floor(Math.random() * types.length)];
          const enemyW = kind === 'crabmeat' ? 43 : 39;
          const enemyH = kind === 'buzzbomber' ? 47 : 42;
          // After a short introductory period, some flyers move high enough
          // that the correct strategy is to stay on the ground, not jump.
          const altitude = kind === 'buzzbomber'
            ? (g.elapsed > 10 && Math.random() > 0.5 ? 75 : 18)
            : 0;
          g.enemies.push({ id: g.nextId++, kind, x: width + 40, w: enemyW, h: enemyH, altitude });
          if (Math.random() > .22) {
            g.rings.push({ id: g.nextId++, x: width + 56, y: height - 59 - 100, taken: false });
          }
          g.nextObstacle = Math.max(.98, 1.55 + Math.random() * .68 - g.elapsed * .005);
        }
        for (const enemy of g.enemies) enemy.x -= g.speed * delta;
        for (const ring of g.rings) ring.x -= g.speed * delta;
        g.enemies = g.enemies.filter(enemy => enemy.x + enemy.w > -8);
        g.rings = g.rings.filter(ring => ring.x > -20 && !ring.taken);
        const playerLeft = PLAYER_X + 10, playerRight = PLAYER_X + 45;
        const playerTop = height - 59 - 48 + g.jumpOffset;
        const playerBottom = height - 59 + g.jumpOffset - 4;
        for (const enemy of g.enemies) {
          const foeBottom = height - 59 - enemyAltitude(enemy, g.elapsed);
          const foeTop = foeBottom - enemy.h;
          if (playerRight > enemy.x + 5 && playerLeft < enemy.x + enemy.w - 5 &&
              playerBottom > foeTop + 5 && playerTop < foeBottom - 5) {
            finish(); break;
          }
        }
        for (const ring of g.rings) {
          if (ring.x >= playerLeft - 8 && ring.x <= playerRight + 8 &&
              ring.y >= playerTop - 14 && ring.y <= playerBottom + 9) {
            ring.taken = true;
            g.ringsCollected++;
          }
        }
        g.score = Math.floor(g.elapsed * 15 + g.ringsCollected * 25);
        if (time - hudAt.current > 110) {
          hudAt.current = time; setScore(g.score); setRings(g.ringsCollected);
        }
      }
      drawScene(gameContext, width, height, g, modeRef.current);
      request = requestAnimationFrame(step);
    }
    request = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(request); observer?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, finish, jump]);

  return <>
    <style>{`
      /* This item is mounted as an eighth child of the existing seven-item
         settings menu. It MUST be its own rounded card, not a square row. */
      .connect-app .settings-menu > div.connect-runner-settings-item {
        margin: 14px 0 0 !important;
        padding: 0 14px !important;
        border: 1px solid var(--glass-stroke) !important;
        border-radius: 22px !important;
        overflow: hidden;
        background: linear-gradient(130deg,
          color-mix(in srgb, var(--wave-secondary) 6%, rgba(107,141,183,.16)),
          rgba(27,38,58,.68) 35%, rgba(37,52,74,.53));
        box-shadow: inset 0 1px 0 var(--glass-sheen), var(--glass-shadow);
        -webkit-backdrop-filter: blur(23px) saturate(145%);
        backdrop-filter: blur(23px) saturate(145%);
      }
      .connect-app .settings-menu > div.connect-runner-settings-item .settings-menu-row {
        width: 100%; min-height: 65px; border: 0; cursor: pointer;
      }
      .connect-app.light .settings-menu > div.connect-runner-settings-item {
        background: linear-gradient(135deg, rgba(255,255,255,.88), rgba(232,240,249,.72));
      }
      .connect-app .connect-runner-screen { position:absolute; inset:0; z-index:8; display:flex;flex-direction:column; min-width:0; min-height:0; padding:13px 9px max(12px,env(safe-area-inset-bottom)); background:linear-gradient(155deg,color-mix(in srgb,var(--bg) 93%,#174672),color-mix(in srgb,var(--bg) 93%,#096c66)); overflow-y:auto; overscroll-behavior:contain; color:var(--text); }
      .connect-app .main-view:has(>.connect-runner-screen) { position:relative; }
      .connect-runner-head { display:flex; justify-content:space-between; align-items:center; gap:12px; margin:0 6px 12px; }
      .connect-runner-head h2 { margin:0; font-size:clamp(23px,5.4vw,29px); font-weight:760; }
      .connect-runner-head button { border:1px solid rgba(180,211,240,.19); background:rgba(63,88,114,.17); color:var(--text); padding:9px 14px; border-radius:14px; font-weight:600; font-size:13px; }
      .connect-runner-subtitle { margin:0 6px 12px; color:var(--muted); font-size:12px; }
      .connect-runner-frame { position:relative; width:100%; overflow:hidden; border:2px solid color-mix(in srgb,var(--accent) 42%,rgba(213,237,255,.33)); border-radius:19px; box-shadow:0 16px 38px rgba(0,0,0,.28),inset 0 1px rgba(255,255,255,.2); background:#76d5f8; }
      .connect-runner-frame canvas { display:block; width:100%; height:clamp(270px,48dvh,415px); image-rendering:pixelated; touch-action:none; }
      .connect-runner-points { display:flex; gap:8px; margin-bottom:11px; }
      .connect-runner-points>span { flex:1; min-width:0; text-align:center; padding:10px 6px; border:1px solid rgba(210,232,255,.12); border-radius:15px; background:rgba(41,61,82,.46); font-size:13px; }
      .connect-runner-points strong { display:block; font-size:20px; line-height:1.2; font-variant-numeric:tabular-nums; }
      .connect-runner-points small { color:var(--muted); }
      .connect-runner-message { position:absolute; top:42%; left:50%; transform:translate(-50%,-50%); width:min(85%,310px); text-align:center; border:1px solid #e1f5ffa8; border-radius:15px; padding:15px 12px; background:rgba(9,35,69,.83); box-shadow:0 9px 26px #16335f55; color:#fff; pointer-events:none; }
      .connect-runner-message strong { display:block; font-size:19px; margin-bottom:6px; }
      .connect-runner-message p { margin:0; font-size:12px; opacity:.87; line-height:1.45; }
      .connect-runner-actions { margin-top:13px; display:flex; gap:9px; }
      .connect-runner-actions button { border:1px solid rgba(190,218,255,.16); color:var(--text); border-radius:15px; padding:12px 13px; flex:1; min-height:46px; background:rgba(39,63,82,.56); font-size:14px; font-weight:700; }
      .connect-runner-actions button.primary { background:var(--accent); color:#fff; border-color:transparent; }
      .connect-runner-tip { margin:12px 5px 3px; color:var(--muted); text-align:center; font-size:12px; line-height:1.45; }
      @media (max-height:700px) { .connect-runner-frame canvas { height:clamp(235px,40dvh,310px); } .connect-runner-subtitle { margin-bottom:8px; } }
      @media (prefers-reduced-motion:reduce) { .connect-runner-actions button { transition:none; } }
    `}</style>
    {menu && createPortal(<div className="connect-runner-settings-item">
      <button type="button" className="settings-menu-row" onClick={openGame}>
        <span className="setting-icon" aria-hidden="true"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8.5h12a3.5 3.5 0 0 1 3.3 2.4l1.2 5a2.5 2.5 0 0 1-4 2.7l-3.2-2.6H8.7l-3.2 2.6a2.5 2.5 0 0 1-4-2.7l1.2-5A3.5 3.5 0 0 1 6 8.5Z"/><path d="M7.5 11.5v4m-2-2h4"/><circle cx="16" cy="12" r=".75" fill="currentColor" stroke="none"/><circle cx="18.5" cy="14.5" r=".75" fill="currentColor" stroke="none"/></svg></span>
        <span><strong>Если скучно</strong><small>Соник: прыжки, роботы и кольца</small></span>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
    </div>, menu)}
    {open && main && createPortal(<section className="connect-runner-screen" aria-label="Мини-игра Соник">
      <header className="connect-runner-head"><h2>Если скучно 🎮</h2><button type="button" onClick={closeGame}>Закрыть</button></header>
      <p className="connect-runner-subtitle">Пиксельный Соник против роботов доктора Эггмана</p>
      <div className="connect-runner-points" aria-live="off">
        <span><strong>{score}</strong><small>Очки</small></span>
        <span><strong>{rings} ◉</strong><small>Кольца</small></span>
        <span><strong>{best}</strong><small>Рекорд</small></span>
      </div>
      <div className="connect-runner-frame">
        <canvas ref={canvas} onPointerDown={() => jump()} aria-label="Игровое поле. Нажмите, чтобы прыгнуть."/>
        {mode !== 'running' && <div className="connect-runner-message"><strong>{mode === 'over' ? 'Игра окончена!' : 'Готов к забегу?'}</strong><p>{mode === 'over' ? `Счёт: ${score}. Ещё одну попытку?` : 'Перепрыгивай наземных и низких роботов. Под высоко летящими Базз Бомберами пробегай снизу! Собирай кольца.'}</p></div>}
      </div>
      <div className="connect-runner-actions">
        <button type="button" className="primary" onClick={mode === 'running' ? jump : start}>{mode === 'running' ? '↑ Прыжок' : mode === 'over' ? '↻ Ещё раз' : '▶ Начать'}</button>
        <button type="button" onClick={closeGame}>Вернуться</button>
      </div>
      <p className="connect-runner-tip">Наземных и низких роботов перепрыгивай, а под высокими пролети… точнее, пробеги! На iPhone — касание, на компьютере — пробел или ↑. Рекорд сохраняется.</p>
    </section>, main)}
  </>;
}
