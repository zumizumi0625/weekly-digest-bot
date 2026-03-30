# Weekly Digest Bot

Discord チャンネルの活動を AI が自動で週次サマリーにまとめる Bot です。
Google Drive の更新追跡にも対応しています（オプション）。

定例ミーティングの活動報告を自動化し、チームの情報共有を効率化します。

## 機能

- **パッシブメッセージ収集** — 指定チャンネル（または全チャンネル）のメッセージを自動保存
- **AI 週次サマリー** — Gemini が過去の会話を分析し、構造化された週次レポートを生成
- **定期実行** — 毎週指定した曜日・時刻に自動でダイジェストを投稿
- **Google Drive 連携**（オプション）— Drive のファイル更新もサマリーに含める
- **完全無料で運用可能**

## コスト

| 項目 | 費用 |
|------|------|
| Gemini 2.5 Flash-Lite API | 無料（1000 RPD） |
| SQLite | 無料 |
| Discord Bot | 無料 |
| ホスティング | 無料（下記参照） |
| **合計** | **$0/月** |

## セットアップ

### 1. Discord Bot の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリックし、名前を入力
3. 「Bot」セクションで以下を設定:
   - 「MESSAGE CONTENT INTENT」を **ON** にする（必須）
   - 「SERVER MEMBERS INTENT」は不要
4. 「Bot」セクションの「Token」をコピー → `.env` の `DISCORD_TOKEN` に設定
5. 「General Information」の「APPLICATION ID」をコピー → `.env` の `DISCORD_CLIENT_ID` に設定
6. 「OAuth2」>「URL Generator」で以下のスコープと権限を選択:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Read Message History`, `Embed Links`
7. 生成された URL でサーバーに Bot を招待

### 2. Gemini API キーの取得（無料）

1. [Google AI Studio](https://aistudio.google.com/apikey) にアクセス
2. 「API キーを作成」をクリック
3. キーをコピー → `.env` の `GEMINI_API_KEY` に設定

Gemini 2.5 Flash-Lite の無料枠:
- 15 RPM（1分あたりリクエスト数）
- 1000 RPD（1日あたりリクエスト数）
- 週次ダイジェスト用途には十分すぎる容量です

### 3. インストールと起動

```bash
# 依存関係のインストール
npm install

# .env ファイルの作成
cp .env.example .env
# .env を編集して各値を設定

# スラッシュコマンドの登録（初回のみ）
npm run register

# ビルド & 起動
npm run build
npm start

# 開発時（ts-node で直接実行）
npm run dev
```

### 4. Google Drive 連携（オプション）

Drive 連携は任意です。Discord のメッセージのみでダイジェストを生成できます。

Drive 連携を有効にする場合:

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「Google Drive API」を有効化
3. 「認証情報」>「サービスアカウント」を作成
4. サービスアカウントの JSON キーをダウンロード
5. 対象の Google Drive フォルダ/ドライブをサービスアカウントと共有
6. 環境変数を設定:
   ```
   GOOGLE_CREDENTIALS_PATH=./service-account.json
   GOOGLE_DRIVE_ID=（共有ドライブの場合のみ）
   ```

## スラッシュコマンド

| コマンド | 説明 |
|---------|------|
| `/digest watch #channel` | チャンネルを監視対象に追加 |
| `/digest unwatch #channel` | チャンネルの監視を解除 |
| `/digest channels` | 監視中のチャンネル一覧 |
| `/digest generate [days]` | ダイジェストを今すぐ生成（デフォルト: 7日） |
| `/digest schedule set #channel <曜日> <時刻>` | 定期スケジュールを設定 |
| `/digest schedule show` | 現在のスケジュールを表示 |
| `/digest drive` | Google Drive の接続状態 |
| `/digest stats` | メッセージ収集の統計 |

## 使い方の例

```
# 特定のチャンネルだけ監視する場合
/digest watch #general
/digest watch #dev
/digest watch #design

# 毎週金曜 17:00 に #weekly-report に投稿
/digest schedule set #weekly-report friday 17:00

# 手動で今すぐ生成（過去14日分）
/digest generate 14
```

## ホスティング（無料）

以下のサービスで無料で運用できます:

### Oracle Cloud Always Free
- **推奨**: ARM インスタンス（4 OCPU, 24GB RAM）が永久無料
- Ubuntu で Node.js をインストールして `pm2` で常駐化
- 最も安定した無料オプション

### Fly.io
- 無料枠: 3 shared-cpu-1x VMs
- `fly launch` で簡単にデプロイ
- ただし無料枠は変更される可能性あり

### Railway
- 月 $5 分の無料クレジット
- GitHub 連携で自動デプロイ

### 自宅サーバー / Raspberry Pi
- 電気代のみ
- `pm2` や `systemd` で常駐化

## 技術構成

```
weekly-digest-bot/
├── src/
│   ├── index.ts           # エントリーポイント
│   ├── config.ts          # 環境変数の読み込み
│   ├── db.ts              # SQLite データベース
│   ├── collector.ts       # メッセージ収集
│   ├── drive.ts           # Google Drive 連携
│   ├── summarizer.ts      # Gemini AI 要約
│   ├── scheduler.ts       # cron スケジューラ
│   ├── commands/
│   │   └── digest.ts      # スラッシュコマンド
│   └── utils/
│       └── format.ts      # Embed フォーマット
└── scripts/
    └── register-commands.ts
```

## ライセンス

MIT
