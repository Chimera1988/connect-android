# Bundled Connect interface

Client source snapshot: Chimera1988/connect-messenger main, commit
`5b9e3cb` (full SHA and file hashes in `../verification/source/PWA-PROVENANCE.json`).
The original `app/page.tsx`, component tree, CSS, SVG and public artwork render
inside a **single** Android Chromium WebView. `hybrid/main.tsx` replaces only
the Next server layout. The existing Connect HTTPS server continues to serve
all `/api/*` and Supabase proxy routes; server source and private keys are not
compiled into this application. No backend migrations are performed.

`npm run build:web` creates one inline script/style document and embeds it in
Metro's offline JavaScript bundle. The WebView's trusted HTTPS base origin is
`https://connect-chat.duckdns.org/`. Original public media are read from APK assets
through the strictly scoped `withConnectWebAssets` interceptor. The app does not
load the remote homepage or use file:// universal access.

Android owns FCM, notification channels, Telecom, native audio WebRTC and
microphone/camera recording. `hybrid/runtime.ts` exposes the existing PWA's
ConnectAndroid facade and an asynchronous versioned request bridge. The native
call surface uses original SVG/CSS while the PWA WebRTC controller is not mounted.
Service workers/Web Push are disabled in this host. Call history stays PWA source.

Changes to upstream UI should be reviewed against this snapshot before copying;
do not rerun old workflow source patchers or replace integration files blindly.
The historic 199-point text-probe audit is not device acceptance and its old
"no WebView" requirement has been superseded by this hybrid architecture.
