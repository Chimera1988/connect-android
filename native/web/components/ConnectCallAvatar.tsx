'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

type AvatarPerson = { id: string; avatar_path?: string | null };

// Convert signed media URLs to the existing Connect proxy on its alternate domain.
function callAvatarMediaUrl(url: string): string {
  if (typeof window === 'undefined' || window.location.hostname !== 'connect-chat.duckdns.org') return url;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  if (!supabaseUrl) return url;
  try {
    const original = new URL(url);
    const base = new URL(supabaseUrl);
    if (original.hostname === base.hostname)
      return window.location.origin + '/supabase' + original.pathname + original.search + original.hash;
    const storageHost = base.hostname.replace('.supabase.co', '.storage.supabase.co');
    if (original.hostname === storageHost)
      return window.location.origin + '/supabase-storage' + original.pathname + original.search + original.hash;
  } catch { /* Keep the original URL when a proxy cannot be used. */ }
  return url;
}

export async function loadCallAvatarUrls(client: SupabaseClient, people: AvatarPerson[]): Promise<Record<string,string>> {
  const rows = await Promise.all(people.filter(person => Boolean(person.avatar_path)).map(async person => {
    try {
      const { data, error } = await client.storage.from('connect-avatars').createSignedUrl(person.avatar_path!, 3600);
      return !error && data?.signedUrl ? [person.id, callAvatarMediaUrl(data.signedUrl)] as const : null;
    } catch { return null; }
  }));
  return Object.fromEntries(rows.filter((row): row is readonly [string,string] => row !== null));
}

export default function ConnectCallAvatar({name, url, className}: {name:string;url?:string|null;className:string}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [url]);
  const letter = Array.from(name.trim())[0]?.toLocaleUpperCase('ru-RU') || '?';
  return <span className={className} aria-hidden="true">
    {url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : letter}
  </span>;
}
