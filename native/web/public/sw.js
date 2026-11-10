/* Connect service worker: messages and incoming audio call notifications. */
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data?.json() || {}; } catch { /* A malformed notification uses defaults. */ }
  const isCall = d.kind === 'incoming-call';
  event.waitUntil(self.registration.showNotification(d.title || 'Connect', {
    body: d.body || (isCall ? 'Входящий аудиозвонок' : 'Новое сообщение'),
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: isCall ? 'connect-call-' + (d.callId || 'incoming') : (d.messageId || undefined),
    data: { kind: d.kind || 'message', conversationId: d.conversationId || null, callId: d.callId || null },
    silent: false,
    ...(isCall ? { requireInteraction: true } : {}),
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const details = event.notification.data || {};
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        client.postMessage(details.kind === 'incoming-call'
          ? { type: 'CONNECT_INCOMING_CALL', callId: details.callId }
          : { type: 'CONNECT_OPEN_CHAT', conversationId: details.conversationId });
        return;
      }
    }
    // The incoming call component will query fresh active calls when the PWA opens.
    await clients.openWindow('/');
  })());
});
