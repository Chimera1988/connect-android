'use client';

import { useEffect } from 'react';

/**
 * Small, presentation-only coordinator for existing Connect popovers.
 * The app's own React click handlers remain the single source of truth.
 * Clicking outside of a menu activates the existing close control instead of
 * changing messaging or contact state in a second component.
 */
export default function ConnectUiCoordinator() {
  useEffect(() => {
    const shell = () => document.querySelector<HTMLElement>('.connect-app');

    function closeChatMenu() {
      const root = shell();
      if (!root?.querySelector('.chat-actions-menu')) return;
      const toggle = root.querySelector<HTMLButtonElement>('.chat-clear-btn');
      if (toggle && !toggle.disabled) toggle.click();
    }

    function closeListMenu() {
      const root = shell();
      const menu = root?.querySelector<HTMLElement>('.list-chat-popover');
      if (!menu) return;
      const cancel = menu.querySelector<HTMLButtonElement>('button:last-child');
      if (cancel && !cancel.disabled) cancel.click();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const root = shell();
      if (!root || !root.contains(target)) return;

      // Existing menus are not modal; dismiss them when interacting with the
      // chat, composer, media, sticker tray, contacts or another navigation tab.
      if (!target.closest('.chat-actions-menu, .chat-clear-btn')) closeChatMenu();
      if (!target.closest('.list-chat-popover')) closeListMenu();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      closeChatMenu();
      closeListMenu();
    }

    function onScroll(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.chat-view .message-scroll, .main-view .scroll-content')) {
        closeChatMenu();
        closeListMenu();
      }
    }

    /** A server-returned Content-Disposition suffix sometimes appears in the
     * preview heading (e.g. "IMG.jpeg; filename*=UTF-8..."). Normalize the
     * *displayed label*; downloading and storage behavior remain untouched. */
    function cleanMediaFilename() {
      const title = document.querySelector<HTMLElement>('.connect-media-overlay .connect-media-toolbar span');
      if (!title) return;
      const value = title.textContent || '';
      const cleaned = value.split(/;\s*filename\*?=/i)[0].trim();
      if (cleaned && cleaned !== value) {
        title.textContent = cleaned;
        title.setAttribute('title', cleaned);
      }
    }

    const mediaObserver = new MutationObserver(cleanMediaFilename);
    mediaObserver.observe(document.body, { childList: true, subtree: true });
    cleanMediaFilename();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);

    return () => {
      mediaObserver.disconnect();
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  return null;
}
