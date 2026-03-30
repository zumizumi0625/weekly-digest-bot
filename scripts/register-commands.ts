import { REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import { digestCommand } from '../src/commands/digest.js';

config();

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  console.error('DISCORD_TOKEN と DISCORD_CLIENT_ID を .env に設定してください。');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

async function registerCommands(): Promise<void> {
  try {
    console.log('スラッシュコマンドを登録中...');

    await rest.put(Routes.applicationCommands(clientId), {
      body: [digestCommand.toJSON()],
    });

    console.log('スラッシュコマンドの登録が完了しました！');
  } catch (err) {
    console.error('コマンドの登録に失敗しました:', err);
    process.exit(1);
  }
}

registerCommands();
