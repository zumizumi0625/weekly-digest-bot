import { Client, GatewayIntentBits, Events } from 'discord.js';
import { Config } from './config.js';
import { getDb } from './db.js';
import { handleMessageCreate } from './collector.js';
import { handleDigestCommand } from './commands/digest.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { pollDriveChanges, isDriveConfigured } from './drive.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// --- イベントハンドラ ---

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[Bot] ${readyClient.user.tag} としてログインしました`);
  console.log(`[Bot] ${readyClient.guilds.cache.size} サーバーに接続中`);

  // DB 初期化
  getDb();
  console.log('[DB] データベースを初期化しました');

  // スケジューラ起動
  startScheduler(client);

  // Drive 初回ポーリング
  if (isDriveConfigured()) {
    console.log('[Drive] Google Drive 連携が有効です。初回ポーリングを実行します...');
    pollDriveChanges().catch(err => console.error('[Drive] 初回ポーリングエラー:', err));
  } else {
    console.log('[Drive] Google Drive 連携は無効です（GOOGLE_CREDENTIALS_PATH が未設定）');
  }
});

// メッセージ収集
client.on(Events.MessageCreate, (message) => {
  handleMessageCreate(message);
});

// スラッシュコマンド処理
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'digest') {
    try {
      await handleDigestCommand(interaction);
    } catch (err) {
      console.error('[Command] エラー:', err);
      const reply = interaction.deferred || interaction.replied
        ? interaction.editReply.bind(interaction)
        : interaction.reply.bind(interaction);
      await reply({ content: 'コマンドの実行中にエラーが発生しました。' }).catch(() => {});
    }
  }
});

// --- 終了処理 ---

function shutdown(): void {
  console.log('[Bot] シャットダウン中...');
  stopScheduler();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- 起動 ---

console.log('[Bot] 起動中...');
client.login(Config.discordToken);
