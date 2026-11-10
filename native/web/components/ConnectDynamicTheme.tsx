'use client';

import { useEffect } from 'react';

type Waves = readonly [primary: string, secondary: string, tertiary: string];

/** Curated combinations for the seven existing Connect accent swatches. */
const PRESET_WAVES: Readonly<Record<string, Waves>> = {
  '#087dff': ['#17b8f8', '#6b92ff', '#94d9ff'], // blue
  '#8055dc': ['#a17afb', '#7e9cf6', '#d48df5'], // violet
  '#dc477e': ['#fa66ad', '#b97af2', '#ff9bba'], // pink
  '#198f78': ['#0ad9b7', '#65acf4', '#79f0d0'], // green/teal
  '#b46b26': ['#f4a951', '#efbf7c', '#fa8568'], // orange
  '#cc4545': ['#f26a72', '#d865a7', '#ffa293'], // red
  '#60748b': ['#9db9ce', '#7199c6', '#b8cadc'], // slate
};

function hexRgb(hex: string): readonly [number, number, number] | null {
  const value = hex.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/.exec(value);
  if (short) {
    return [0, 1, 2].map(i => parseInt(short[1][i] + short[1][i], 16)) as unknown as readonly [number, number, number];
  }
  const full = /^#([0-9a-f]{6})$/.exec(value);
  if (!full) return null;
  return [0, 2, 4].map(i => parseInt(full[1].slice(i, i + 2), 16)) as unknown as readonly [number, number, number];
}

function rgbHueSaturation(rgb: readonly [number, number, number]): { hue: number; saturation: number } {
  const [r, g, b] = rgb.map(channel => channel / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue: (hue * 60 + 360) % 360, saturation: saturation * 100 };
}

function wavesFromAccent(accent: string): Waves {
  const normalized = accent.trim().toLowerCase();
  if (PRESET_WAVES[normalized]) return PRESET_WAVES[normalized];
  const rgb = hexRgb(normalized);
  if (!rgb) return PRESET_WAVES['#087dff'];
  const { hue, saturation } = rgbHueSaturation(rgb);
  // Every custom hex color gets a coherent triad, without replacing the UI accent.
  const sat = Math.min(87, Math.max(58, saturation));
  const color = (shift: number, s: number, l: number) => `hsl(${Math.round((hue + shift + 360) % 360)} ${Math.round(s)}% ${l}%)`;
  return [color(0, sat, 57), color(24, sat * .86, 68), color(-18, sat * .74, 69)];
}

/**
 * Reads the accent already managed by the app. No duplicate theme state and no
 * changes to auth, messaging, wallpaper storage, or push logic are necessary.
 * Watching the root style allows the existing color picker to update instantly.
 */
export default function ConnectDynamicTheme() {
  useEffect(() => {
    let shell: HTMLElement | null = null;
    let styleObserver: MutationObserver | null = null;
    let lastAccent = '';
    let lastPalette: Waves | null = null;

    function apply() {
      if (!shell) return;
      const accent = shell.style.getPropertyValue('--accent').trim() || '#087dff';
      if (accent !== lastAccent || !lastPalette) {
        lastAccent = accent;
        lastPalette = wavesFromAccent(accent);
      }
      const [primary, secondary, tertiary] = lastPalette;
      const properties: Record<string, string> = {
        '--wave-primary': primary,
        '--wave-secondary': secondary,
        '--wave-tertiary': tertiary,
      };
      for (const [property, color] of Object.entries(properties)) {
        if (shell.style.getPropertyValue(property) !== color) shell.style.setProperty(property, color);
      }
    }

    function attach() {
      const next = document.querySelector<HTMLElement>('.connect-app');
      if (!next || next === shell) return;
      styleObserver?.disconnect();
      shell = next;
      lastAccent = '';
      lastPalette = null;
      styleObserver = new MutationObserver(apply);
      styleObserver.observe(shell, { attributes: true, attributeFilter: ['style'] });
      apply();
    }

    // Next.js can mount/replace the app shell after this client component.
    const treeObserver = new MutationObserver(attach);
    treeObserver.observe(document.body, { childList: true, subtree: true });
    attach();
    return () => {
      treeObserver.disconnect();
      styleObserver?.disconnect();
    };
  }, []);
  return null;
}
