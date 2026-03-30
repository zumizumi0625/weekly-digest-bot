import { config } from 'dotenv';
config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません。.env ファイルを確認してください。`);
  }
  return value;
}

export const Config = {
  discordToken: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('DISCORD_CLIENT_ID'),
  geminiApiKey: requireEnv('GEMINI_API_KEY'),

  // Google Drive (オプション)
  googleCredentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || '',
  googleDriveId: process.env.GOOGLE_DRIVE_ID || '',

  // Gemini モデル設定
  geminiModel: 'gemini-2.5-flash-lite',

  // Drive ポーリング間隔 (6時間)
  drivePollIntervalHours: 6,

  get isDriveEnabled(): boolean {
    return !!this.googleCredentialsPath;
  },
} as const;
