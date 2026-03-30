import { EmbedBuilder } from 'discord.js';

/**
 * ダイジェスト用の Discord Embed を構築する
 */
export function buildDigestEmbed(
  summary: string,
  messageCount: number,
  driveChangeCount: number,
  periodStart: Date,
  periodEnd: Date,
): EmbedBuilder {
  const startStr = periodStart.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const endStr = periodEnd.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const embed = new EmbedBuilder()
    .setTitle(`Weekly Digest (${startStr} - ${endStr})`)
    .setColor(0x5865f2)
    .setTimestamp();

  // Discord Embed の description は 4096 文字まで
  if (summary.length > 4096) {
    embed.setDescription(summary.slice(0, 4050) + '\n\n...(文字数制限により省略)');
  } else {
    embed.setDescription(summary);
  }

  const footerParts = [`${messageCount} 件のメッセージを分析`];
  if (driveChangeCount > 0) {
    footerParts.push(`${driveChangeCount} 件の Drive 更新`);
  }
  footerParts.push('Powered by Gemini');
  embed.setFooter({ text: footerParts.join(' | ') });

  return embed;
}

/**
 * 曜日名を日本語に変換する
 */
export function dayToJapanese(day: string): string {
  const map: Record<string, string> = {
    sunday: '日曜日',
    monday: '月曜日',
    tuesday: '火曜日',
    wednesday: '水曜日',
    thursday: '木曜日',
    friday: '金曜日',
    saturday: '土曜日',
  };
  return map[day.toLowerCase()] ?? day;
}

/**
 * 曜日名のバリデーション
 */
export const VALID_DAYS = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const;

export type DayOfWeek = (typeof VALID_DAYS)[number];

export function isValidDay(day: string): day is DayOfWeek {
  return VALID_DAYS.includes(day.toLowerCase() as DayOfWeek);
}

/**
 * 時刻文字列のバリデーション (HH:MM)
 */
export function isValidTime(time: string): boolean {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}
