import { google, drive_v3 } from 'googleapis';
import { readFileSync } from 'fs';
import { Config } from './config.js';
import {
  getDriveConfig,
  updateDrivePageToken,
  insertDriveChange,
  getAllDigestSchedules,
} from './db.js';

let driveClient: drive_v3.Drive | null = null;

/**
 * Google Drive クライアントを初期化する
 * 認証情報が設定されていない場合は null を返す
 */
function initDriveClient(): drive_v3.Drive | null {
  if (!Config.isDriveEnabled) return null;

  try {
    const credentialsJson = readFileSync(Config.googleCredentialsPath, 'utf-8');
    const credentials = JSON.parse(credentialsJson);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });

    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.error('[Drive] 認証情報の読み込みに失敗しました:', err);
    return null;
  }
}

/**
 * Drive の変更を取得して DB に保存する
 */
export async function pollDriveChanges(): Promise<void> {
  if (!Config.isDriveEnabled) return;

  if (!driveClient) {
    driveClient = initDriveClient();
    if (!driveClient) return;
  }

  // 全ギルドのスケジュールからギルド ID を取得
  const schedules = getAllDigestSchedules();
  const guildIds = [...new Set(schedules.map(s => s.guild_id))];

  if (guildIds.length === 0) {
    console.log('[Drive] スケジュールが設定されているギルドがありません。スキップします。');
    return;
  }

  for (const guildId of guildIds) {
    await pollForGuild(guildId);
  }
}

async function pollForGuild(guildId: string): Promise<void> {
  if (!driveClient) return;

  const config = getDriveConfig(guildId);
  let pageToken = config?.page_token;

  try {
    // 初回はスタートページトークンを取得
    if (!pageToken) {
      const startRes = await driveClient.changes.getStartPageToken({
        ...(Config.googleDriveId ? { driveId: Config.googleDriveId, supportsAllDrives: true } : {}),
      });
      pageToken = startRes.data.startPageToken ?? undefined;
      if (pageToken) {
        updateDrivePageToken(guildId, pageToken);
      }
      console.log(`[Drive] ギルド ${guildId} の初期ページトークンを取得しました。次回のポーリングから変更を追跡します。`);
      return;
    }

    // 変更を取得
    const res = await driveClient.changes.list({
      pageToken,
      includeItemsFromAllDrives: !!Config.googleDriveId,
      supportsAllDrives: !!Config.googleDriveId,
      ...(Config.googleDriveId ? { driveId: Config.googleDriveId } : {}),
      fields: 'nextPageToken,newStartPageToken,changes(fileId,file(name,webViewLink,lastModifyingUser,trashed),removed,changeType)',
    });

    const changes = res.data.changes ?? [];
    for (const change of changes) {
      if (change.changeType !== 'file') continue;

      const file = change.file;
      if (!file) continue;

      let changeType = 'modified';
      if (change.removed || file.trashed) {
        changeType = 'deleted';
      }

      insertDriveChange(
        guildId,
        change.fileId ?? '',
        file.name ?? '不明なファイル',
        file.webViewLink ?? '',
        file.lastModifyingUser?.displayName ?? '不明',
        changeType,
      );
    }

    // ページトークンを更新
    const newToken = res.data.newStartPageToken ?? res.data.nextPageToken;
    if (newToken) {
      updateDrivePageToken(guildId, newToken);
    }

    if (changes.length > 0) {
      console.log(`[Drive] ギルド ${guildId}: ${changes.length} 件の変更を検出しました。`);
    }
  } catch (err) {
    console.error(`[Drive] ギルド ${guildId} のポーリングに失敗しました:`, err);
  }
}

/**
 * Google Drive が有効かどうかを返す
 */
export function isDriveConfigured(): boolean {
  return Config.isDriveEnabled;
}
