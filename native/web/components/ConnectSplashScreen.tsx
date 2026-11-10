'use client';

import { useEffect, useState } from 'react';

const BRAND = 'Connect'.split('');
// Exact character boundaries measured from the approved Connect screenshot.
const WORD_CUTS = [0, 17.6, 32.6, 46.7, 61.1, 75.8, 89.6, 100] as const;

type Props = {
  ready: boolean;
  onComplete: () => void;
};

/**
 * The letters are the only loading indicator: the final "t" is revealed only
 * after the initial session and chat directory have finished loading.
 */
export default function ConnectSplashScreen({ ready, onComplete }: Props) {
  const [letters, setLetters] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (letters >= BRAND.length - 1) return;
    const timer = window.setTimeout(() => setLetters(letters + 1), 200);
    return () => window.clearTimeout(timer);
  }, [letters]);

  useEffect(() => {
    if (!ready || letters !== BRAND.length - 1) return;
    const timer = window.setTimeout(() => setLetters(BRAND.length), 200);
    return () => window.clearTimeout(timer);
  }, [ready, letters]);

  useEffect(() => {
    if (!ready || letters !== BRAND.length) return;
    const fade = window.setTimeout(() => setLeaving(true), 300);
    const done = window.setTimeout(onComplete, 750);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [ready, letters, onComplete]);

  // Network failures must not leave a permanent overlay in front of login.
  useEffect(() => {
    const timeout = window.setTimeout(onComplete, 12000);
    return () => window.clearTimeout(timeout);
  }, [onComplete]);

  return (
    <div className={'connect-splash' + (leaving ? ' connect-splash--leaving' : '')}
      role="status" aria-label="Загрузка Connect">
      <svg className="connect-splash__waves" viewBox="0 0 430 900"
        preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="splashUpper" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a7bdcc" stopOpacity=".12"/>
            <stop offset=".5" stopColor="#465c70" stopOpacity=".18"/>
            <stop offset="1" stopColor="#09131e" stopOpacity=".02"/>
          </linearGradient>
          <linearGradient id="splashLower" x1="0" y1="0" x2=".7" y2="1">
            <stop offset="0" stopColor="#bbcbd8" stopOpacity=".02"/>
            <stop offset=".43" stopColor="#526c82" stopOpacity=".25"/>
            <stop offset="1" stopColor="#1b3145" stopOpacity=".22"/>
          </linearGradient>
          <linearGradient id="splashEdge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#859aa9" stopOpacity=".04"/>
            <stop offset=".42" stopColor="#dceaf4" stopOpacity=".55"/>
            <stop offset="1" stopColor="#b0cadb" stopOpacity=".12"/>
          </linearGradient>
        </defs>
        <g className="connect-splash__upper-wave">
          <path d="M-80 250 C80 265 181 199 285 116 S438 43 520 -18 L520 -90 L-80 -90Z"
            fill="url(#splashUpper)"/>
          <path d="M-80 250 C80 265 181 199 285 116 S438 43 520 -18"
            fill="none" stroke="url(#splashEdge)" strokeWidth="2"/>
          <path d="M-90 305 C100 245 191 213 317 163 S450 110 520 97"
            fill="none" stroke="#687f93" strokeWidth="1" strokeOpacity=".27"/>
        </g>
        <g className="connect-splash__lower-wave">
          <path d="M-80 676 C79 787 153 751 260 677 S418 587 530 601 L530 990 L-80 990Z"
            fill="url(#splashLower)" opacity=".95"/>
          <path d="M-80 676 C79 787 153 751 260 677 S418 587 530 601"
            fill="none" stroke="url(#splashEdge)" strokeWidth="2.4"/>
          <path d="M-100 754 C87 823 169 767 264 717 S436 687 540 651"
            fill="none" stroke="#92a9b9" strokeOpacity=".6" strokeWidth="2"/>
          <path d="M-100 809 C75 883 193 794 300 763 S424 738 536 722"
            fill="none" stroke="#536f84" strokeOpacity=".25" strokeWidth="1"/>
        </g>
      </svg>
      <div className="connect-splash__center">
        <img className="connect-splash__icon" src="/connect-splash-bubbles-exact-silver.png" alt="" aria-hidden="true" draggable={false} />
        <div className="connect-splash__word" role="img" aria-label="Connect">
          {BRAND.map((character, index) => (
            <span key={character + index} aria-hidden="true"
              className={'connect-splash__word-slice' + (index < letters ? ' is-visible' : '')}
              style={{clipPath: `inset(0 ${100 - WORD_CUTS[index + 1]}% 0 ${WORD_CUTS[index]}%)`}}>
              <img src="/connect-splash-wordmark-reference.png" alt="" draggable={false}/>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
