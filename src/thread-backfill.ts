import { ChannelType, Client, TextChannel, ThreadChannel } from 'discord.js';
import { insertMessage, isChannelWatched, getWatchedChannels } from './db.js';

export interface ThreadBackfillResult {
  threadsScanned: number;
  messagesInserted: number;
}

/**
 * 指定ギルドの監視対象チャンネル内にある全スレッド（アクティブ＋アーカイブ済み）から
 * sinceDate 以降のメッセージを取得して DB に保存する。
 *
 * Bot がオフラインだった間 or Bot 参加前に書き込まれたスレッドメッセージを
 * ダイジェスト対象に含めるために使用する。
 */
export async function backfillThreadMessages(
  client: Client,
  guildId: string,
  sinceDate: Date,
): Promise<ThreadBackfillResult> {
  const guild = await client.guilds.fetch(guildId);
  const result: ThreadBackfillResult = { threadsScanned: 0, messagesInserted: 0 };

  // 監視対象チャンネルを特定
  const watched = getWatchedChannels(guildId);
  const watchAll = watched.length === 0;

  // --- アクティブスレッド ---
  const activeThreads = await guild.channels.fetchActiveThreads();
  for (const thread of activeThreads.threads.values()) {
    if (!thread.parentId) continue;
    if (!watchAll && !watched.some((w) => w.channel_id === thread.parentId)) continue;

    if (!thread.joined) await thread.join().catch(() => {});
    result.threadsScanned++;
    result.messagesInserted += await fetchAndStore(thread, guildId, sinceDate);
  }

  // --- アーカイブ済みスレッド ---
  const textChannels = watchAll
    ? [...guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).values()] as TextChannel[]
    : await Promise.all(
        watched.map(async (w) => {
          const ch = await guild.channels.fetch(w.channel_id).catch(() => null);
          return ch?.type === ChannelType.GuildText ? (ch as TextChannel) : null;
        }),
      ).then((chs) => chs.filter(Boolean) as TextChannel[]);

  for (const channel of textChannels) {
    // 公開アーカイブ
    try {
      const archived = await channel.threads.fetchArchived({ type: 'public', fetchAll: true });
      for (const thread of archived.threads.values()) {
        if (!thread.joined) await thread.join().catch(() => {});
        result.threadsScanned++;
        result.messagesInserted += await fetchAndStore(thread, guildId, sinceDate);
      }
    } catch {
      // 権限不足等
    }

    // 非公開アーカイブ (MANAGE_THREADS 権限が必要)
    try {
      const archived = await channel.threads.fetchArchived({ type: 'private', fetchAll: true });
      for (const thread of archived.threads.values()) {
        if (!thread.joined) await thread.join().catch(() => {});
        result.threadsScanned++;
        result.messagesInserted += await fetchAndStore(thread, guildId, sinceDate);
      }
    } catch {
      // 権限不足等 — 無視
    }

    await sleep(300);
  }

  return result;
}

/**
 * スレッド内のメッセージを sinceDate まで遡って取得し DB に INSERT OR IGNORE する。
 */
async function fetchAndStore(
  thread: ThreadChannel,
  guildId: string,
  sinceDate: Date,
): Promise<number> {
  let count = 0;
  let before: string | undefined;

  while (true) {
    const messages = await thread.messages.fetch({ limit: 100, before });
    if (messages.size === 0) break;

    let reachedOld = false;
    for (const [, msg] of messages) {
      if (msg.createdAt < sinceDate) {
        reachedOld = true;
        break;
      }
      if (msg.author.bot) continue;
      if (!msg.content?.trim()) continue;

      insertMessage(
        msg.id,
        guildId,
        thread.id,
        thread.name,
        msg.author.id,
        msg.author.displayName ?? msg.author.username,
        msg.content,
        msg.createdAt.toISOString(),
      );
      count++;
    }

    if (reachedOld) break;
    before = messages.last()?.id;
    await sleep(200);
  }

  return count;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
