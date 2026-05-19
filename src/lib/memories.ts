import { supabase } from './supabase';
import { getLocalMemories, getSyncValue, setSyncValue, upsertLocalMemories } from './localDb';

export type MemoryKind = 'text' | 'photo' | 'voice';

export type Memory = {
  id: string;
  circle_id: string;
  author_id: string;
  kind: MemoryKind;
  title: string;
  note: string | null;
  content_base64: string | null;
  content_mime_type: string | null;
  memory_date: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

type CircleMemoryCache = {
  memories: Memory[];
  lastSyncedAt: string | null;
};

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function memorySyncKey(circleId: string) {
  return `circle:${circleId}:memories:lastSyncedAt`;
}

export function todayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function encodeTextAsBase64(value: string) {
  const bytes = encodeUtf8(value);
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? '=' : alphabet[third & 63];
  }

  return output;
}

function encodeUtf8(value: string) {
  const encoded = encodeURIComponent(value);
  const bytes: number[] = [];

  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }

  return bytes;
}

export async function readCachedMemories(circleId: string) {
  const [memories, lastSyncedAt] = await Promise.all([
    getLocalMemories(circleId),
    getSyncValue(memorySyncKey(circleId)),
  ]);

  return { memories, lastSyncedAt } satisfies CircleMemoryCache;
}

export async function writeCachedMemories(circleId: string, cache: CircleMemoryCache) {
  await Promise.all([
    upsertLocalMemories(cache.memories),
    setSyncValue(memorySyncKey(circleId), cache.lastSyncedAt),
  ]);
}

export async function syncCircleMemories(circleId: string) {
  const cache = await readCachedMemories(circleId);
  let query = supabase
    .from('memories')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  if (cache.lastSyncedAt) {
    query = query.gt('updated_at', cache.lastSyncedAt);
  }

  const { data, error } = await query;

  if (error) {
    return { memories: cache.memories, synced: false, error };
  }

  await upsertLocalMemories((data ?? []) as Memory[]);
  const memories = await getLocalMemories(circleId);
  const newestDownloadedAt = ((data ?? []) as Memory[]).reduce<string | null>((newest, memory) => {
    if (!newest) return memory.updated_at;
    return new Date(memory.updated_at) > new Date(newest) ? memory.updated_at : newest;
  }, null);

  await writeCachedMemories(circleId, {
    memories,
    lastSyncedAt: newestDownloadedAt ?? cache.lastSyncedAt,
  });

  return { memories, synced: true, error: null };
}

export function selectTodayMemories(memories: Memory[], currentDate = todayKey()) {
  return memories.filter((memory) => memory.memory_date === currentDate);
}

export function selectMemoryGems(memories: Memory[], count = 5, currentDate = todayKey()) {
  return memories
    .filter((memory) => memory.memory_date < currentDate)
    .sort(() => Math.random() - 0.5)
    .slice(0, count);
}
