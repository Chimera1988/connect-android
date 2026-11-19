// Segment settings according to their meaning, never their index.
// This remains correct when administrator-only entries appear/disappear.
function settingsMenuGroup(id: string): string {
  if (id === 'appearance' || id === 'stickers') return 'personal';
  if (id === 'members' || id === 'usage') return 'administration';
  if (id === 'notifications' || id === 'data' || id === 'privacy') return 'application';
  if (id === 'about') return 'about';
  return 'other';
}

export function settingsMenuSegmentClasses<T extends {id:string}>(items: readonly T[], i: number): string {
  const group = settingsMenuGroup(items[i].id);
  const first = i === 0 || settingsMenuGroup(items[i-1].id) !== group;
  const last = i === items.length-1 || settingsMenuGroup(items[i+1].id) !== group;
  return [first && 'settings-segment-start', last && 'settings-segment-end'].filter(Boolean).join(' ');
}
