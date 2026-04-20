import { Message, ThreadChannel } from 'discord.js';
import { insertMessage, isChannelWatched } from './db.js';

/**
 * メッセージ収集ハンドラ
 * messageCreate イベントで呼び出され、監視対象チャンネルのメッセージを DB に保存する
 */
export function handleMessageCreate(message: Message): void {
  // Bot のメッセージは無視
  if (message.author.bot) return;

  // DM は無視
  if (!message.guild) return;

  // 空メッセージは無視（画像のみ等）
  if (!message.content || message.content.trim() === '') return;

  const guildId = message.guild.id;
  const channelId = message.channel.id;

  // 監視対象チャンネルかチェック
  // スレッド内メッセージの場合は親チャンネルも確認する
  const isThread = message.channel.isThread();
  const parentId = isThread ? (message.channel as ThreadChannel).parentId : null;
  const watched = isChannelWatched(guildId, channelId)
    || (parentId != null && isChannelWatched(guildId, parentId));
  if (!watched) return;

  const channelName = 'name' in message.channel ? (message.channel.name ?? '不明') : '不明';

  insertMessage(
    message.id,
    guildId,
    channelId,
    channelName,
    message.author.id,
    message.author.displayName ?? message.author.username,
    message.content,
    message.createdAt.toISOString(),
  );
}
