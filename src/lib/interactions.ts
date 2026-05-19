import {
  LocalMemoryLike,
  getLocalComments,
  getLocalCommentsForMemory,
  getLocalLikes,
  getLocalMemberNames,
  getSyncValue,
  setSyncValue,
  upsertLocalComments,
  upsertLocalLikes,
  upsertLocalMemberNames,
} from './localDb';
import { supabase } from './supabase';

export type MemoryInteraction = {
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
};

export type LikeState = {
  likesLimit: number;
  likesUsed: number;
};

export type MemoryComment = {
  id: string;
  memory_id: string;
  circle_id: string;
  user_id: string;
  body: string;
  created_at: string;
};

type CircleInteractionCache = {
  interactions: Record<string, MemoryInteraction>;
  likeState: LikeState;
  likes: LocalMemoryLike[];
  comments: MemoryComment[];
  memberNames: Record<string, string>;
  lastLikesSyncedAt: string | null;
  lastCommentsSyncedAt: string | null;
  cachedAt: string;
};

function likesSyncKey(circleId: string) {
  return `circle:${circleId}:likes:lastSyncedAt`;
}

function commentsSyncKey(circleId: string) {
  return `circle:${circleId}:comments:lastSyncedAt`;
}

export async function readCachedCircleInteractions(circleId: string, currentDate?: string, currentUserId?: string | null) {
  const [likes, comments, memberNames, lastLikesSyncedAt, lastCommentsSyncedAt] = await Promise.all([
    getLocalLikes(circleId),
    getLocalComments(circleId),
    getLocalMemberNames(circleId),
    getSyncValue(likesSyncKey(circleId)),
    getSyncValue(commentsSyncKey(circleId)),
  ]);

  return {
    interactions: buildInteractions(likes, comments, currentUserId ?? null),
    likeState: currentDate
      ? buildOfflineLikeState(likes, memberNames, currentDate, currentUserId ?? null)
      : { likesLimit: Object.keys(memberNames).length, likesUsed: 0 },
    likes,
    comments,
    memberNames,
    lastLikesSyncedAt,
    lastCommentsSyncedAt,
    cachedAt: new Date().toISOString(),
  } satisfies CircleInteractionCache;
}

export async function loadCircleInteractions(circleId: string, currentDate: string, currentUserId: string | null) {
  const cached = await readCachedCircleInteractions(circleId, currentDate, currentUserId);
  let likesQuery = supabase
    .from('memory_likes')
    .select('memory_id,circle_id,user_id,like_date,created_at')
    .eq('circle_id', circleId);
  let commentsQuery = supabase
    .from('memory_comments')
    .select('id,memory_id,circle_id,user_id,body,created_at')
    .eq('circle_id', circleId);

  if (cached?.lastLikesSyncedAt) {
    likesQuery = likesQuery.gt('created_at', cached.lastLikesSyncedAt);
  }

  if (cached?.lastCommentsSyncedAt) {
    commentsQuery = commentsQuery.gt('created_at', cached.lastCommentsSyncedAt);
  }

  const [likesResult, commentsResult, stateResult] = await Promise.all([
    likesQuery,
    commentsQuery,
    supabase.rpc('get_circle_like_state', { circle_id_input: circleId, like_date_input: currentDate }).single(),
  ]);

  const error = likesResult.error ?? commentsResult.error ?? stateResult.error;
  if (error) {
    const offlineInteractions = buildInteractions(cached?.likes ?? [], cached?.comments ?? [], currentUserId);
    return {
      interactions: offlineInteractions,
      likeState: buildOfflineLikeState(cached?.likes ?? [], cached?.memberNames ?? {}, currentDate, currentUserId),
      comments: cached?.comments ?? [],
      memberNames: cached?.memberNames ?? {},
      error,
      synced: false,
    };
  }

  const likes = mergeByKey(cached?.likes ?? [], (likesResult.data ?? []) as LocalMemoryLike[], (like) => `${like.memory_id}:${like.user_id}`);
  const comments = mergeByKey(cached?.comments ?? [], (commentsResult.data ?? []) as MemoryComment[], (comment) => comment.id);
  const interactions = buildInteractions(likes, comments, currentUserId);

  const state = stateResult.data as { likes_limit?: number; likes_used?: number } | null;
  const likeState = {
    likesLimit: state?.likes_limit ?? 0,
    likesUsed: state?.likes_used ?? 0,
  } satisfies LikeState;
  const memberNames = await loadCircleMemberNames(circleId);
  const lastLikesSyncedAt = newestCreatedAt((likesResult.data ?? []) as LocalMemoryLike[]) ?? cached?.lastLikesSyncedAt ?? null;
  const lastCommentsSyncedAt = newestCreatedAt((commentsResult.data ?? []) as MemoryComment[]) ?? cached?.lastCommentsSyncedAt ?? null;

  await Promise.all([
    upsertLocalLikes((likesResult.data ?? []) as LocalMemoryLike[]),
    upsertLocalComments((commentsResult.data ?? []) as MemoryComment[]),
    upsertLocalMemberNames(circleId, memberNames),
    setSyncValue(likesSyncKey(circleId), lastLikesSyncedAt),
    setSyncValue(commentsSyncKey(circleId), lastCommentsSyncedAt),
  ]);

  return {
    interactions,
    likeState,
    comments,
    memberNames,
    error: null,
    synced: true,
  };
}

function buildInteractions(likes: LocalMemoryLike[], comments: MemoryComment[], currentUserId: string | null) {
  const interactions: Record<string, MemoryInteraction> = {};

  for (const like of likes) {
    interactions[like.memory_id] = interactions[like.memory_id] ?? { likeCount: 0, commentCount: 0, likedByMe: false };
    interactions[like.memory_id].likeCount += 1;
    interactions[like.memory_id].likedByMe = interactions[like.memory_id].likedByMe || like.user_id === currentUserId;
  }

  for (const comment of comments) {
    interactions[comment.memory_id] = interactions[comment.memory_id] ?? { likeCount: 0, commentCount: 0, likedByMe: false };
    interactions[comment.memory_id].commentCount += 1;
  }

  return interactions;
}

function buildOfflineLikeState(
  likes: LocalMemoryLike[],
  memberNames: Record<string, string>,
  currentDate: string,
  currentUserId: string | null,
) {
  return {
    likesLimit: Object.keys(memberNames).length,
    likesUsed: currentUserId
      ? likes.filter((like) => like.user_id === currentUserId && like.like_date === currentDate).length
      : 0,
  } satisfies LikeState;
}

function mergeByKey<T>(existing: T[], incoming: T[], getKey: (item: T) => string) {
  const merged = new Map(existing.map((item) => [getKey(item), item]));
  for (const item of incoming) {
    merged.set(getKey(item), item);
  }
  return Array.from(merged.values());
}

function newestCreatedAt(items: { created_at: string }[]) {
  return items.reduce<string | null>((newest, item) => {
    if (!newest) return item.created_at;
    return new Date(item.created_at) > new Date(newest) ? item.created_at : newest;
  }, null);
}

export async function loadCircleMemberNames(circleId: string) {
  const { data, error } = await supabase
    .from('circle_members')
    .select('user_id,nickname')
    .eq('circle_id', circleId);

  if (error) {
    const cached = await readCachedCircleInteractions(circleId);
    return cached?.memberNames ?? {};
  }

  return Object.fromEntries(
    (data ?? []).map((member) => [
      member.user_id as string,
      (member.nickname as string | null) || 'Someone',
    ]),
  ) as Record<string, string>;
}

export async function loadMemoryComments(memoryId: string, circleId?: string) {
  const { data, error } = await supabase
    .from('memory_comments')
    .select('id,memory_id,circle_id,user_id,body,created_at')
    .eq('memory_id', memoryId)
    .order('created_at', { ascending: true });

  if (error && circleId) {
    return { comments: await getLocalCommentsForMemory(memoryId), error };
  }

  await upsertLocalComments((data ?? []) as MemoryComment[]);
  return { comments: (data ?? []) as MemoryComment[], error };
}
