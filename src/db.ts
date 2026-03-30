import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'digest.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS watched_channels (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      message_id TEXT UNIQUE,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drive_changes (
      id INTEGER PRIMARY KEY,
      guild_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      file_name TEXT,
      file_url TEXT,
      modified_by TEXT,
      change_type TEXT,
      detected_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS drive_config (
      guild_id TEXT PRIMARY KEY,
      credentials_json TEXT,
      page_token TEXT,
      last_poll TEXT
    );

    CREATE TABLE IF NOT EXISTS digest_schedule (
      guild_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      day_of_week TEXT NOT NULL,
      time TEXT NOT NULL,
      timezone TEXT DEFAULT 'Asia/Tokyo'
    );

    CREATE TABLE IF NOT EXISTS digest_history (
      id INTEGER PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      content TEXT NOT NULL,
      message_count INTEGER,
      period_start TEXT,
      period_end TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_messages_guild_created
      ON messages(guild_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_channel_created
      ON messages(channel_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_drive_changes_guild
      ON drive_changes(guild_id, detected_at);
  `);
}

// --- Watched Channels ---

export function addWatchedChannel(guildId: string, channelId: string, channelName: string): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO watched_channels (guild_id, channel_id, channel_name)
    VALUES (?, ?, ?)
  `).run(guildId, channelId, channelName);
}

export function removeWatchedChannel(guildId: string, channelId: string): void {
  getDb().prepare(`
    DELETE FROM watched_channels WHERE guild_id = ? AND channel_id = ?
  `).run(guildId, channelId);
}

export function getWatchedChannels(guildId: string): Array<{ channel_id: string; channel_name: string }> {
  return getDb().prepare(`
    SELECT channel_id, channel_name FROM watched_channels WHERE guild_id = ?
  `).all(guildId) as Array<{ channel_id: string; channel_name: string }>;
}

export function isChannelWatched(guildId: string, channelId: string): boolean {
  const channels = getWatchedChannels(guildId);
  // チャンネルが未設定の場合は全チャンネルを監視
  if (channels.length === 0) return true;
  return channels.some(c => c.channel_id === channelId);
}

// --- Messages ---

export function insertMessage(
  messageId: string,
  guildId: string,
  channelId: string,
  channelName: string,
  authorId: string,
  authorName: string,
  content: string,
  createdAt: string,
): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO messages
      (message_id, guild_id, channel_id, channel_name, author_id, author_name, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(messageId, guildId, channelId, channelName, authorId, authorName, content, createdAt);
}

export interface StoredMessage {
  message_id: string;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export function getMessagesInPeriod(guildId: string, startDate: string, endDate: string): StoredMessage[] {
  return getDb().prepare(`
    SELECT message_id, guild_id, channel_id, channel_name, author_id, author_name, content, created_at
    FROM messages
    WHERE guild_id = ? AND created_at >= ? AND created_at <= ?
    ORDER BY created_at ASC
  `).all(guildId, startDate, endDate) as StoredMessage[];
}

export function getMessageCount(guildId: string): number {
  const row = getDb().prepare(`
    SELECT COUNT(*) as count FROM messages WHERE guild_id = ?
  `).get(guildId) as { count: number };
  return row.count;
}

// --- Drive Changes ---

export function insertDriveChange(
  guildId: string,
  fileId: string,
  fileName: string,
  fileUrl: string,
  modifiedBy: string,
  changeType: string,
): void {
  getDb().prepare(`
    INSERT INTO drive_changes (guild_id, file_id, file_name, file_url, modified_by, change_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, fileId, fileName, fileUrl, modifiedBy, changeType);
}

export interface StoredDriveChange {
  file_id: string;
  file_name: string;
  file_url: string;
  modified_by: string;
  change_type: string;
  detected_at: string;
}

export function getDriveChangesInPeriod(guildId: string, startDate: string, endDate: string): StoredDriveChange[] {
  return getDb().prepare(`
    SELECT file_id, file_name, file_url, modified_by, change_type, detected_at
    FROM drive_changes
    WHERE guild_id = ? AND detected_at >= ? AND detected_at <= ?
    ORDER BY detected_at ASC
  `).all(guildId, startDate, endDate) as StoredDriveChange[];
}

// --- Drive Config ---

export function getDriveConfig(guildId: string): { credentials_json: string; page_token: string; last_poll: string } | undefined {
  return getDb().prepare(`
    SELECT credentials_json, page_token, last_poll FROM drive_config WHERE guild_id = ?
  `).get(guildId) as { credentials_json: string; page_token: string; last_poll: string } | undefined;
}

export function upsertDriveConfig(guildId: string, credentialsJson: string): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO drive_config (guild_id, credentials_json) VALUES (?, ?)
  `).run(guildId, credentialsJson);
}

export function updateDrivePageToken(guildId: string, pageToken: string): void {
  getDb().prepare(`
    UPDATE drive_config SET page_token = ?, last_poll = datetime('now') WHERE guild_id = ?
  `).run(pageToken, guildId);
}

// --- Digest Schedule ---

export function setDigestSchedule(
  guildId: string,
  channelId: string,
  dayOfWeek: string,
  time: string,
): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO digest_schedule (guild_id, channel_id, day_of_week, time)
    VALUES (?, ?, ?, ?)
  `).run(guildId, channelId, dayOfWeek, time);
}

export interface DigestScheduleRow {
  guild_id: string;
  channel_id: string;
  day_of_week: string;
  time: string;
  timezone: string;
}

export function getDigestSchedule(guildId: string): DigestScheduleRow | undefined {
  return getDb().prepare(`
    SELECT guild_id, channel_id, day_of_week, time, timezone FROM digest_schedule WHERE guild_id = ?
  `).get(guildId) as DigestScheduleRow | undefined;
}

export function getAllDigestSchedules(): DigestScheduleRow[] {
  return getDb().prepare(`
    SELECT guild_id, channel_id, day_of_week, time, timezone FROM digest_schedule
  `).all() as DigestScheduleRow[];
}

// --- Digest History ---

export function insertDigestHistory(
  guildId: string,
  channelId: string,
  content: string,
  messageCount: number,
  periodStart: string,
  periodEnd: string,
): void {
  getDb().prepare(`
    INSERT INTO digest_history (guild_id, channel_id, content, message_count, period_start, period_end)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, channelId, content, messageCount, periodStart, periodEnd);
}
