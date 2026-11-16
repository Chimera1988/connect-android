'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('about screen identifies installed Android 3.0.6 (24), not legacy 2.2.5',()=>{
 const page=read('web/app/page.tsx');
 assert.match(page,/Версия 3\.0\.6 \(24\)/);
 assert.doesNotMatch(page,/Версия 2\.2\.5/);
});
test('Android sound menu contains only Connect defaults and native custom picker actions',()=>{
 const menu=read('web/components/ConnectNotificationSettings.tsx');
 assert.doesNotMatch(menu,/<select id="connect-sound"/);
 assert.doesNotMatch(menu,/Сигнал для всех чатов/);
 assert.match(menu,/Connect — сообщение/);
 assert.match(menu,/Connect — звонок/);
 assert.match(menu,/connect-sound-icon-button/g);
 assert.match(menu,/aria-label=\{`Выбрать/);
 assert.match(menu,/window\.ConnectAndroid\?\.pickSound/);
 assert.match(menu,/window\.ConnectAndroid\?\.previewSound/);
 assert.match(menu,/window\.ConnectAndroid\?\.resetSound/);
 assert.match(menu,/window\.ConnectAndroid\?\.setSilent/);
 assert.match(menu,/notification:diagnostics/);
});
test('Android sound defaults really map to Connect bundled resources',()=>{
 const policy=read('web/lib/android-sound-policy.ts');
 const native=read('src/ConnectNativeSoundSettings.tsx');
 assert.match(policy,/soft'\?'connect_notification'/);
 assert.match(native,/connect_ringtone/);
 assert.match(native,/getConnectSoundChannel/);
});
test('Android bottom dock has four stable slots and no moving pseudo-highlight',()=>{
 const css=read('web/app/liquid-glass.css');
 assert.match(css,/CONNECT_ANDROID_STATIC_DOCK_UI_20261116/);
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/\.bottom-nav::before\s*\{[^}]*display:none/s);
 assert.match(css,/\.connect-calls-tab\s*\{[^}]*grid-column:3/s);
});
test('Android calls screen does not place a second glass curtain over chat waves',()=>{
 const css=read('web/app/liquid-glass.css');
 assert.match(css,/CONNECT_ANDROID_CALL_LIST_CLEAR_UI_20261116/);
 assert.match(css,/\.connect-call-history-screen\s*\{[^}]*background:transparent/s);
 assert.match(css,/\.connect-call-history-list\s*\{[^}]*background:transparent/s);
});
test('unresolved custom stickers show loading rather than premature unavailable error',()=>{
 const page=read('web/app/page.tsx');
 assert.match(page,/stickerUnavailableIds/);
 assert.match(page,/connect_stickers'\)\s*\.select\('id,pack_id,name,storage_path,position'\)\.in\('id',missing\)/);
 assert.match(page,/connect-sticker-loading/);
 assert.doesNotMatch(page,/!st&&stickerCatalogReady\?<span>Стикер недоступен<\/span>/);
});
