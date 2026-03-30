import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import {
  getAllDigestSchedules,
  getMessagesInPeriod,
  getDriveChangesInPeriod,
  insertDigestHistory,
  DigestScheduleRow,
} from './db.js';
import { generateDigest } from './summarizer.js';
import { buildDigestEmbed } from './utils/format.js';
import { pollDriveChanges, isDriveConfigured } from './drive.js';
import { Config } from './config.js';

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

let scheduledTasks: cron.ScheduledTask[] = [];

/**
 * 全スケジュールの cron タスクを起動する
 */
export function startScheduler(client: Client): void {
  stopScheduler();

  const schedules = getAllDigestSchedules();

  for (const schedule of schedules) {
    const task = createCronTask(client, schedule);
    if (task) {
      scheduledTasks.push(task);
      console.log(
        `[Scheduler] ギルド ${schedule.guild_id}: 毎週${schedule.day_of_week} ${schedule.time} にダイジェストを送信します`,
      );
    }
  }

  // Google Drive ポーリング（6時間ごと）
  if (isDriveConfigured()) {
    const driveTask = cron.schedule(`0 */${Config.drivePollIntervalHours} * * *`, async () => {
      console.log('[Scheduler] Google Drive のポーリングを実行中...');
      await pollDriveChanges();
    });
    scheduledTasks.push(driveTask);
    console.log(`[Scheduler] Google Drive ポーリング: ${Config.drivePollIntervalHours} 時間ごと`);
  }

  console.log(`[Scheduler] ${schedules.length} 件のスケジュールを起動しました`);
}

/**
 * スケジュールを再読み込みする
 */
export function reloadScheduler(client: Client): void {
  startScheduler(client);
}

/**
 * 全スケジュールを停止する
 */
export function stopScheduler(): void {
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks = [];
}

/**
 * スケジュールから cron タスクを作成する
 */
function createCronTask(client: Client, schedule: DigestScheduleRow): cron.ScheduledTask | null {
  const dayNum = DAY_MAP[schedule.day_of_week.toLowerCase()];
  if (dayNum === undefined) {
    console.error(`[Scheduler] 無効な曜日: ${schedule.day_of_week}`);
    return null;
  }

  const [hour, minute] = schedule.time.split(':').map(Number);
  if (isNaN(hour) || isNaN(minute)) {
    console.error(`[Scheduler] 無効な時刻: ${schedule.time}`);
    return null;
  }

  // cron: minute hour * * dayOfWeek
  const cronExpr = `${minute} ${hour} * * ${dayNum}`;

  return cron.schedule(
    cronExpr,
    async () => {
      console.log(`[Scheduler] ギルド ${schedule.guild_id} のダイジェスト生成を開始します...`);
      await executeDigest(client, schedule.guild_id, schedule.channel_id, 7);
    },
    { timezone: schedule.timezone },
  );
}

/**
 * ダイジェストを生成して投稿する
 */
export async function executeDigest(
  client: Client,
  guildId: string,
  channelId: string,
  days: number,
): Promise<string> {
  const now = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString();
  const endDate = now.toISOString();

  // メッセージ取得
  const messages = getMessagesInPeriod(guildId, startDate, endDate);

  // Drive 変更取得
  const driveChanges = isDriveConfigured()
    ? getDriveChangesInPeriod(guildId, startDate, endDate)
    : [];

  // AI 要約生成
  const summary = await generateDigest(messages, driveChanges, startDate, endDate);

  // Embed 構築
  const embed = buildDigestEmbed(summary, messages.length, driveChanges.length, start, now);

  // チャンネルに送信
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel instanceof TextChannel) {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error(`[Scheduler] チャンネル ${channelId} への送信に失敗しました:`, err);
  }

  // 履歴に保存
  insertDigestHistory(guildId, channelId, summary, messages.length, startDate, endDate);

  console.log(
    `[Scheduler] ギルド ${guildId}: ダイジェスト生成完了 (メッセージ: ${messages.length} 件, Drive: ${driveChanges.length} 件)`,
  );

  return summary;
}
