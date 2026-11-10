'use client';
export default function InviteShareButton({ link }: { link: string }) {
  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Приглашение в Connect', text: 'Приглашаю тебя в Connect', url: link });
      } else {
        await navigator.clipboard.writeText(link);
        alert('Ссылка скопирована. Теперь её можно отправить.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      alert('Не удалось поделиться ссылкой. Используй «Скопировать ссылку».');
    }
  }
  return <button type="button" className="settings-action" onClick={() => void share()}>Поделиться приглашением</button>;
}
