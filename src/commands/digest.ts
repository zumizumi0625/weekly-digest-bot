import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import {
  addWatchedChannel,
  removeWatchedChannel,
  getWatchedChannels,
  getMessageCount,
  setDigestSchedule,
  getDigestSchedule,
} from '../db.js';
import { executeDigest, reloadScheduler } from '../scheduler.js';
import { isDriveConfigured } from '../drive.js';
import { dayToJapanese, isValidDay, isValidTime } from '../utils/format.js';
import { backfillThreadMessages } from '../thread-backfill.js';

export const digestCommand = new SlashCommandBuilder()
  .setName('digest')
  .setDescription('週次ダイジェストの管理')
  .addSubcommand(sub =>
    sub
      .setName('watch')
      .setDescription('チャンネルを監視対象に追加する')
      .addChannelOption(opt =>
        opt
          .setName('channel')
          .setDescription('監視するチャンネル')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('unwatch')
      .setDescription('チャンネルの監視を解除する')
      .addChannelOption(opt =>
        opt
          .setName('channel')
          .setDescription('監視解除するチャンネル')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('channels').setDescription('監視中のチャンネル一覧を表示する'),
  )
  .addSubcommand(sub =>
    sub
      .setName('generate')
      .setDescription('ダイジェストを今すぐ生成する')
      .addIntegerOption(opt =>
        opt
          .setName('days')
          .setDescription('何日分を対象にするか（デフォルト: 7）')
          .setMinValue(1)
          .setMaxValue(30),
      ),
  )
  .addSubcommandGroup(group =>
    group
      .setName('schedule')
      .setDescription('定期ダイジェストのスケジュール管理')
      .addSubcommand(sub =>
        sub
          .setName('set')
          .setDescription('定期ダイジェストのスケジュールを設定する')
          .addChannelOption(opt =>
            opt
              .setName('channel')
              .setDescription('ダイジェストを投稿するチャンネル')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true),
          )
          .addStringOption(opt =>
            opt
              .setName('day')
              .setDescription('曜日 (例: friday)')
              .setRequired(true)
              .addChoices(
                { name: '月曜日', value: 'monday' },
                { name: '火曜日', value: 'tuesday' },
                { name: '水曜日', value: 'wednesday' },
                { name: '木曜日', value: 'thursday' },
                { name: '金曜日', value: 'friday' },
                { name: '土曜日', value: 'saturday' },
                { name: '日曜日', value: 'sunday' },
              ),
          )
          .addStringOption(opt =>
            opt.setName('time').setDescription('時刻 (例: 17:00)').setRequired(true),
          ),
      )
      .addSubcommand(sub =>
        sub.setName('show').setDescription('現在のスケジュールを表示する'),
      ),
  )
  .addSubcommand(sub =>
    sub
      .setName('backfill-threads')
      .setDescription('過去のスレッドメッセージを取り込む')
      .addIntegerOption(opt =>
        opt
          .setName('days')
          .setDescription('何日分を対象にするか（デフォルト: 30）')
          .setMinValue(1)
          .setMaxValue(365),
      ),
  )
  .addSubcommand(sub =>
    sub.setName('drive').setDescription('Google Drive の接続状態を表示する'),
  )
  .addSubcommand(sub =>
    sub.setName('stats').setDescription('メッセージ収集の統計を表示する'),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function handleDigestCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true });
    return;
  }

  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand();

  if (subcommandGroup === 'schedule') {
    if (subcommand === 'set') {
      await handleScheduleSet(interaction, guildId);
    } else if (subcommand === 'show') {
      await handleScheduleShow(interaction, guildId);
    }
    return;
  }

  switch (subcommand) {
    case 'watch':
      await handleWatch(interaction, guildId);
      break;
    case 'unwatch':
      await handleUnwatch(interaction, guildId);
      break;
    case 'channels':
      await handleChannels(interaction, guildId);
      break;
    case 'generate':
      await handleGenerate(interaction, guildId);
      break;
    case 'backfill-threads':
      await handleBackfillThreads(interaction, guildId);
      break;
    case 'drive':
      await handleDriveStatus(interaction);
      break;
    case 'stats':
      await handleStats(interaction, guildId);
      break;
  }
}

async function handleWatch(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  addWatchedChannel(guildId, channel.id, channel.name ?? '不明');
  await interaction.reply({
    content: `<#${channel.id}> を監視対象に追加しました。`,
    ephemeral: true,
  });
}

async function handleUnwatch(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  removeWatchedChannel(guildId, channel.id);
  await interaction.reply({
    content: `<#${channel.id}> の監視を解除しました。`,
    ephemeral: true,
  });
}

async function handleChannels(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const channels = getWatchedChannels(guildId);
  if (channels.length === 0) {
    await interaction.reply({
      content: '監視対象のチャンネルが未設定です。全チャンネルのメッセージを収集しています。\n`/digest watch #channel` で特定のチャンネルのみに制限できます。',
      ephemeral: true,
    });
    return;
  }

  const list = channels.map(c => `- <#${c.channel_id}> (${c.channel_name})`).join('\n');
  await interaction.reply({
    content: `**監視中のチャンネル:**\n${list}`,
    ephemeral: true,
  });
}

async function handleGenerate(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const days = interaction.options.getInteger('days') ?? 7;

  await interaction.deferReply();

  try {
    // ダイジェスト生成前にスレッドメッセージを取り込み（漏れ防止）
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const bf = await backfillThreadMessages(interaction.client, guildId, sinceDate);
    if (bf.messagesInserted > 0) {
      console.log(`[Thread Backfill] ${bf.threadsScanned} スレッドから ${bf.messagesInserted} 件取り込み`);
    }

    await executeDigest(interaction.client, guildId, interaction.channelId, days);
    await interaction.editReply(`過去 ${days} 日分のダイジェストを生成しました。`);
  } catch (err) {
    console.error('[Digest] ダイジェスト生成エラー:', err);
    await interaction.editReply('ダイジェストの生成中にエラーが発生しました。ログを確認してください。');
  }
}

async function handleBackfillThreads(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const days = interaction.options.getInteger('days') ?? 30;

  await interaction.deferReply();

  try {
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await interaction.editReply(`⏳ 過去 ${days} 日分のスレッドメッセージを取り込み中... (数分かかる場合あり)`);

    const result = await backfillThreadMessages(interaction.client, guildId, sinceDate);
    await interaction.editReply(
      `✅ スレッド Backfill 完了\n` +
      `- スレッド走査: ${result.threadsScanned}\n` +
      `- メッセージ取り込み: ${result.messagesInserted}`,
    );
  } catch (err) {
    console.error('[Thread Backfill] エラー:', err);
    await interaction.editReply('❌ スレッド Backfill 失敗。ログを確認してください。');
  }
}

async function handleScheduleSet(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const day = interaction.options.getString('day', true);
  const time = interaction.options.getString('time', true);

  if (!isValidDay(day)) {
    await interaction.reply({
      content: '無効な曜日です。monday, tuesday, ... sunday のいずれかを指定してください。',
      ephemeral: true,
    });
    return;
  }

  if (!isValidTime(time)) {
    await interaction.reply({
      content: '無効な時刻です。HH:MM 形式で指定してください（例: 17:00）。',
      ephemeral: true,
    });
    return;
  }

  setDigestSchedule(guildId, channel.id, day.toLowerCase(), time);
  reloadScheduler(interaction.client);

  await interaction.reply({
    content: `毎週${dayToJapanese(day)} ${time} (JST) に <#${channel.id}> でダイジェストを生成します。`,
    ephemeral: true,
  });
}

async function handleScheduleShow(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const schedule = getDigestSchedule(guildId);
  if (!schedule) {
    await interaction.reply({
      content: 'スケジュールが設定されていません。\n`/digest schedule set #channel <曜日> <時刻>` で設定してください。',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content: `**現在のスケジュール:**\n- 送信先: <#${schedule.channel_id}>\n- 毎週${dayToJapanese(schedule.day_of_week)} ${schedule.time} (${schedule.timezone})`,
    ephemeral: true,
  });
}

async function handleDriveStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (isDriveConfigured()) {
    await interaction.reply({
      content: '**Google Drive 連携:** 有効\nDrive の変更を定期的にポーリングしています。',
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: `**Google Drive 連携:** 無効\n\nGoogle Drive 連携を有効にするには:\n1. Google Cloud Console でサービスアカウントを作成\n2. Drive API を有効化\n3. サービスアカウントの JSON キーをダウンロード\n4. 環境変数 \`GOOGLE_CREDENTIALS_PATH\` にファイルパスを設定\n5. Bot を再起動\n\n※ Drive 連携はオプションです。Discord のみでも利用できます。`,
      ephemeral: true,
    });
  }
}

async function handleStats(interaction: ChatInputCommandInteraction, guildId: string): Promise<void> {
  const totalMessages = getMessageCount(guildId);
  const channels = getWatchedChannels(guildId);

  const lines = [
    `**メッセージ収集統計:**`,
    `- 保存済みメッセージ: ${totalMessages.toLocaleString()} 件`,
    `- 監視チャンネル: ${channels.length === 0 ? '全チャンネル' : `${channels.length} チャンネル`}`,
    `- Google Drive: ${isDriveConfigured() ? '有効' : '無効'}`,
  ];

  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}
