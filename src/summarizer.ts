import { GoogleGenAI } from '@google/genai';
import { Config } from './config.js';
import { StoredMessage, StoredDriveChange } from './db.js';

const ai = new GoogleGenAI({ apiKey: Config.geminiApiKey });

// Gemini のトークン上限を考慮したチャンク分割の目安（文字数ベース）
const MAX_CHARS_PER_CHUNK = 80_000;

interface ChannelMessages {
  channelName: string;
  messages: StoredMessage[];
}

/**
 * メッセージをチャンネルごとにグループ化する
 */
function groupByChannel(messages: StoredMessage[]): ChannelMessages[] {
  const map = new Map<string, ChannelMessages>();
  for (const msg of messages) {
    const key = msg.channel_id;
    if (!map.has(key)) {
      map.set(key, { channelName: msg.channel_name, messages: [] });
    }
    map.get(key)!.messages.push(msg);
  }
  return Array.from(map.values());
}

/**
 * チャンネルメッセージをテキスト形式にフォーマットする
 */
function formatChannelMessages(groups: ChannelMessages[]): string {
  const parts: string[] = [];
  for (const group of groups) {
    parts.push(`\n### #${group.channelName} (${group.messages.length} 件のメッセージ)`);
    for (const msg of group.messages) {
      const date = new Date(msg.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
      parts.push(`[${date}] ${msg.author_name}: ${msg.content}`);
    }
  }
  return parts.join('\n');
}

/**
 * Drive 変更をテキスト形式にフォーマットする
 */
function formatDriveChanges(changes: StoredDriveChange[]): string {
  if (changes.length === 0) return '';

  const parts: string[] = ['\n### Google Drive の更新'];
  for (const change of changes) {
    const typeLabel = change.change_type === 'deleted' ? '削除' : change.change_type === 'created' ? '新規' : '更新';
    parts.push(`- [${typeLabel}] ${change.file_name} (${change.modified_by}) ${change.file_url}`);
  }
  return parts.join('\n');
}

/**
 * 要約プロンプトを構築する
 */
function buildPrompt(
  startDate: string,
  endDate: string,
  messagesText: string,
  driveText: string,
): string {
  const start = new Date(startDate).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const end = new Date(endDate).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });

  return `以下は過去1週間の Discord チャンネルでの会話です。
各チャンネルの活動を要約し、以下の形式で週次レポートを作成してください：

## 週次活動サマリー（${start} 〜 ${end}）

### チャンネル別活動
各チャンネルごとに:
- 主な議論テーマ
- 決定事項
- 進捗・成果
- 課題・懸案事項

${driveText ? `### Google Drive 更新（ある場合）
- 新規作成・更新されたファイル一覧
` : ''}

### 今週のハイライト
- 特に重要な出来事 3-5 件

### 来週に向けて
- 未解決の課題
- 予定されているタスク（会話から推測）

---
以下が会話ログです:
${messagesText}
${driveText}

上記の会話ログを元に、日本語で週次レポートを作成してください。Markdown 形式で出力してください。
Discord の Embed に表示するため、各セクションは簡潔にまとめてください（合計 4000 文字以内）。`;
}

/**
 * テキストをチャンクに分割する
 */
function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHARS_PER_CHUNK) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    // 改行位置で分割して途中で切れないようにする
    let splitAt = MAX_CHARS_PER_CHUNK;
    if (remaining.length > MAX_CHARS_PER_CHUNK) {
      const lastNewline = remaining.lastIndexOf('\n', MAX_CHARS_PER_CHUNK);
      if (lastNewline > MAX_CHARS_PER_CHUNK * 0.5) {
        splitAt = lastNewline;
      }
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

/**
 * Gemini API を使ってメッセージを要約する
 */
export async function generateDigest(
  messages: StoredMessage[],
  driveChanges: StoredDriveChange[],
  startDate: string,
  endDate: string,
): Promise<string> {
  if (messages.length === 0 && driveChanges.length === 0) {
    return '対象期間にメッセージや活動が見つかりませんでした。';
  }

  const groups = groupByChannel(messages);
  const messagesText = formatChannelMessages(groups);
  const driveText = formatDriveChanges(driveChanges);

  const fullText = messagesText + driveText;
  const chunks = splitIntoChunks(fullText);

  let summary: string;

  if (chunks.length === 1) {
    // 単一チャンクの場合はそのまま要約
    const prompt = buildPrompt(startDate, endDate, messagesText, driveText);
    summary = await callGemini(prompt);
  } else {
    // 複数チャンクの場合は段階的に要約
    const chunkSummaries: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkPrompt = `以下は Discord チャンネルの会話ログの一部です（パート ${i + 1}/${chunks.length}）。
主要な議論テーマ、決定事項、進捗を簡潔にまとめてください：

${chunks[i]}`;
      const chunkSummary = await callGemini(chunkPrompt);
      chunkSummaries.push(chunkSummary);

      // レート制限対策: チャンク間で少し待つ
      if (i < chunks.length - 1) {
        await sleep(4000);
      }
    }

    // チャンク要約を統合
    const mergePrompt = buildPrompt(
      startDate,
      endDate,
      chunkSummaries.join('\n\n---\n\n'),
      driveText,
    );
    summary = await callGemini(mergePrompt);
  }

  // 4000文字制限（Discord Embed）
  if (summary.length > 4000) {
    summary = summary.slice(0, 3950) + '\n\n...(文字数制限により省略)';
  }

  return summary;
}

/**
 * Gemini API を呼び出す（レート制限のリトライ付き）
 */
async function callGemini(prompt: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: Config.geminiModel,
        contents: prompt,
      });
      return response.text ?? '要約の生成に失敗しました。';
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Error && (err.message.includes('429') || err.message.includes('RESOURCE_EXHAUSTED'));
      if (isRateLimit && attempt < retries - 1) {
        console.warn(`[Gemini] レート制限に達しました。${(attempt + 1) * 10} 秒後にリトライします...`);
        await sleep((attempt + 1) * 10_000);
        continue;
      }
      throw err;
    }
  }
  return '要約の生成に失敗しました。';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
