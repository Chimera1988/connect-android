'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Calls journal is one exclusive main screen for both Android and PWA', () => {
  const calls = read('web/components/ConnectCallsHub.tsx');
  const styles = read('web/app/call-journal-editor.css');
  assert.match(calls, /className=\{"connect-call-history-screen connect-pwa-call-journal"/);
  assert.doesNotMatch(calls, /!window\.ConnectAndroid&&!window\.ConnectNative\?" connect-pwa-call-journal"/);
  assert.match(styles, /\.main-view:has\(> \.connect-pwa-call-journal\) > :not\(\.connect-pwa-call-journal\)\s*\{\s*display:none !important;/);
  assert.match(styles, /\.main-view > \.connect-call-history-screen\.connect-pwa-call-journal\s*\{[^}]*position:relative/s);
});

test('Other dock tabs close Calls after click is processed, not on pointerdown', () => {
  const calls = read('web/components/ConnectCallsHub.tsx');
  assert.match(calls, /document\.addEventListener\('click',onOtherTab\)/);
  assert.doesNotMatch(calls, /nativeRuntime\s*\?\s*'pointerdown'/);
});

test('Dock always has four stable slots, only glass selection capsule moves', () => {
  const css = read('web/app/liquid-glass.css');
  const block = css.split('CONNECT_ANDROID_PWA_DOCK_PARITY_20261116')[1];
  assert.ok(block, 'Missing scoped Android dock parity CSS');
  assert.match(block, /grid-template-columns:\s*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(block, /\.bottom-nav::before\s*\{[^}]*display:block\s*!important/s);
  assert.match(block, /\.connect-calls-tab\.selected\)::before\s*\{[^}]*translate3d\(200%,/s);
  assert.match(block, /nth-child\(3\):not\(\.connect-calls-tab\)\.selected\)::before\s*\{[^}]*translate3d\(300%,/s);
  assert.match(block, /\.bottom-nav\s*>\s*\.nav-tab\.selected\s*\{[^}]*background:transparent\s*!important/s);
});

test('Android Connect melody cards use available panel width', () => {
  const css = read('web/app/liquid-glass.css');
  const block = css.split('CONNECT_ANDROID_PWA_DOCK_PARITY_20261116')[1];
  assert.ok(block);
  assert.match(block, /\.connect-android-sounds\s*\{[^}]*align-items:stretch\s*!important/s);
  assert.match(block, /\.connect-sound-card\s*\{[^}]*width:100%\s*!important/s);
  assert.match(block, /\.connect-sound-icon-row\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/s);
});
