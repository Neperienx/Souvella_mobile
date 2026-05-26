import * as SQLite from 'expo-sqlite';

import type { Memory } from './memories';
import type { MemoryComment } from './interactions';

export type LocalMemoryLike = {
  memory_id: string;
  circle_id: string;
  user_id: string;
  like_date: string;
  created_at: string;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let initPromise: Promise<void> | null = null;

function getDb() {
  dbPromise = dbPromise ?? SQLite.openDatabaseAsync('souvella.db');
  return dbPromise;
}

async function addColumnIfMissing(db: SQLite.SQLiteDatabase, tableName: string, columnName: string, definition: string) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
  if (!columns.some((column) => column.name === columnName)) {
    await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export async function initLocalDb() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const db = await getDb();
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        circle_id TEXT NOT NULL,
        author_id TEXT,
        author_name_snapshot TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        note TEXT,
        content_base64 TEXT,
        content_mime_type TEXT,
        memory_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_by TEXT
      );

      CREATE INDEX IF NOT EXISTS memories_circle_created_idx
      ON memories (circle_id, created_at);

      CREATE INDEX IF NOT EXISTS memories_circle_updated_idx
      ON memories (circle_id, updated_at);

      CREATE TABLE IF NOT EXISTS memory_likes (
        memory_id TEXT NOT NULL,
        circle_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        like_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS memory_likes_circle_created_idx
      ON memory_likes (circle_id, created_at);

      CREATE TABLE IF NOT EXISTS memory_comments (
        id TEXT PRIMARY KEY NOT NULL,
        memory_id TEXT NOT NULL,
        circle_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS memory_comments_circle_created_idx
      ON memory_comments (circle_id, created_at);

      CREATE TABLE IF NOT EXISTS circle_members (
        circle_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        nickname TEXT,
        PRIMARY KEY (circle_id, user_id)
      );
    `);

    await addColumnIfMissing(db, 'memories', 'deleted_at', 'TEXT');
    await addColumnIfMissing(db, 'memories', 'deleted_by', 'TEXT');
    await addColumnIfMissing(db, 'memories', 'author_name_snapshot', 'TEXT');
  })();

  return initPromise;
}

export async function getSyncValue(key: string) {
  await initLocalDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string | null }>('SELECT value FROM sync_state WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSyncValue(key: string, value: string | null) {
  await initLocalDb();
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export async function getLocalMemories(circleId: string) {
  await initLocalDb();
  const db = await getDb();
  return db.getAllAsync<Memory>(
    'SELECT * FROM memories WHERE circle_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    circleId,
  );
}

export async function deleteLocalMemory(memoryId: string) {
  await initLocalDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM memory_comments WHERE memory_id = ?', memoryId);
    await db.runAsync('DELETE FROM memory_likes WHERE memory_id = ?', memoryId);
    await db.runAsync('DELETE FROM memories WHERE id = ?', memoryId);
  });
}

export async function upsertLocalMemories(memories: Memory[]) {
  if (memories.length === 0) return;

  await initLocalDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const memory of memories) {
      if (memory.deleted_at) {
        await db.runAsync('DELETE FROM memory_comments WHERE memory_id = ?', memory.id);
        await db.runAsync('DELETE FROM memory_likes WHERE memory_id = ?', memory.id);
        await db.runAsync('DELETE FROM memories WHERE id = ?', memory.id);
        continue;
      }

      await db.runAsync(
        `
          INSERT INTO memories (
            id, circle_id, author_id, author_name_snapshot, kind, title, note, content_base64,
            content_mime_type, memory_date, created_at, updated_at, deleted_at, deleted_by
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            circle_id = excluded.circle_id,
            author_id = excluded.author_id,
            author_name_snapshot = excluded.author_name_snapshot,
            kind = excluded.kind,
            title = excluded.title,
            note = excluded.note,
            content_base64 = excluded.content_base64,
            content_mime_type = excluded.content_mime_type,
            memory_date = excluded.memory_date,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at,
            deleted_by = excluded.deleted_by
        `,
        memory.id,
        memory.circle_id,
        memory.author_id ?? '',
        memory.author_name_snapshot,
        memory.kind,
        memory.title,
        memory.note,
        memory.content_base64,
        memory.content_mime_type,
        memory.memory_date,
        memory.created_at,
        memory.updated_at,
        memory.deleted_at,
        memory.deleted_by,
      );
    }
  });
}

export async function getLocalLikes(circleId: string) {
  await initLocalDb();
  const db = await getDb();
  return db.getAllAsync<LocalMemoryLike>(
    'SELECT * FROM memory_likes WHERE circle_id = ? ORDER BY created_at ASC',
    circleId,
  );
}

export async function upsertLocalLikes(likes: LocalMemoryLike[]) {
  if (likes.length === 0) return;

  await initLocalDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const like of likes) {
      await db.runAsync(
        `
          INSERT INTO memory_likes (memory_id, circle_id, user_id, like_date, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(memory_id, user_id) DO UPDATE SET
            circle_id = excluded.circle_id,
            like_date = excluded.like_date,
            created_at = excluded.created_at
        `,
        like.memory_id,
        like.circle_id,
        like.user_id,
        like.like_date,
        like.created_at,
      );
    }
  });
}

export async function getLocalComments(circleId: string) {
  await initLocalDb();
  const db = await getDb();
  return db.getAllAsync<MemoryComment>(
    'SELECT * FROM memory_comments WHERE circle_id = ? ORDER BY created_at ASC',
    circleId,
  );
}

export async function getLocalCommentsForMemory(memoryId: string) {
  await initLocalDb();
  const db = await getDb();
  return db.getAllAsync<MemoryComment>(
    'SELECT * FROM memory_comments WHERE memory_id = ? ORDER BY created_at ASC',
    memoryId,
  );
}

export async function upsertLocalComments(comments: MemoryComment[]) {
  if (comments.length === 0) return;

  await initLocalDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const comment of comments) {
      await db.runAsync(
        `
          INSERT INTO memory_comments (id, memory_id, circle_id, user_id, body, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            memory_id = excluded.memory_id,
            circle_id = excluded.circle_id,
            user_id = excluded.user_id,
            body = excluded.body,
            created_at = excluded.created_at
        `,
        comment.id,
        comment.memory_id,
        comment.circle_id,
        comment.user_id,
        comment.body,
        comment.created_at,
      );
    }
  });
}

export async function getLocalMemberNames(circleId: string) {
  await initLocalDb();
  const db = await getDb();
  const rows = await db.getAllAsync<{ user_id: string; nickname: string | null }>(
    'SELECT user_id, nickname FROM circle_members WHERE circle_id = ?',
    circleId,
  );

  return Object.fromEntries(rows.map((row) => [row.user_id, row.nickname || 'Someone'])) as Record<string, string>;
}

export async function upsertLocalMemberNames(circleId: string, memberNames: Record<string, string>) {
  await initLocalDb();
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [userId, nickname] of Object.entries(memberNames)) {
      await db.runAsync(
        `
          INSERT INTO circle_members (circle_id, user_id, nickname)
          VALUES (?, ?, ?)
          ON CONFLICT(circle_id, user_id) DO UPDATE SET nickname = excluded.nickname
        `,
        circleId,
        userId,
        nickname,
      );
    }
  });
}
