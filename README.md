# 数秘鑑定 手書きOCR → Google Sheets 管理 v001

スマホで手書き鑑定記録を撮影し、AIで項目別に読み取り、確認・修正してから Google スプレッドシートへ確定登録する v001 です。

## v001でできること

- スマホカメラ撮影 / 写真選択
- 撮影画像を自動圧縮
- 原本画像を Google Drive に保存
- Gemini で日本語手書き鑑定シートを構造化抽出
- 「読めない箇所」を要確認として表示
- スマホ上でOCR結果を修正
- 確定後に Sheets へ登録
- 人物マスタ / 鑑定記録 / 鑑定詳細 / OCR受付を分離保存
- 氏名・ローマ字・生年月日で鑑定一覧を検索
- 鑑定詳細と原本Drive画像を確認

## 構成

```text
スマホ / PC
  ↓
Vercel (public UI + /api)
  ├─ Gemini API：手書き画像 → JSON
  └─ Apps Script Web App：Drive / Sheets 操作
       ├─ Google Drive：原本画像
       └─ Google Sheets：人物・鑑定・OCRログ
```

APIキーや共有シークレットはブラウザには出しません。

---

# 1. Apps Script / スプレッドシート側セットアップ

1. Google Drive で「新しい Apps Script プロジェクト」を作成します。
2. `gas/Code.gs` の内容を、Apps Script の `Code.gs` に丸ごと貼り付けます。
3. Apps Script の「プロジェクトの設定」でタイムゾーンを **日本 / GMT+09:00** にします。
4. エディタ上部の関数選択から `setupNumerologyV001` を選択し、1回実行します。
5. 初回のみ Google Drive / Sheets への権限を許可します。
6. 実行ログに以下が表示されます。

```text
Spreadsheet URL: ...
Drive Folder URL: ...
GAS_SHARED_SECRET: ...
```

`GAS_SHARED_SECRET` は後ほど Vercel の環境変数に入れます。他人に共有しないでください。

### 自動作成されるシート

- `人物マスタ`
- `鑑定記録`
- `鑑定詳細`
- `OCR受付`

---

# 2. Apps Script を Webアプリとしてデプロイ

Apps Script 右上の **デプロイ → 新しいデプロイ → ウェブアプリ** を選びます。

- 実行するユーザー：**自分**
- アクセスできるユーザー：Vercel のサーバーから呼び出せる設定（通常は **全員**）

デプロイ後に発行される `/exec` で終わる URL を控えます。

この Web App は公開URLになりますが、v001では全POSTリクエストを `GAS_SHARED_SECRET` で照合します。

---

# 3. Gemini API Key

Google AI Studio で Gemini API Key を作成して控えます。

v001 の既定モデルは `.env.example` の `gemini-3.6-flash` です。モデル名を変更する場合はコード変更不要で `GEMINI_MODEL` だけ変更できます。

---

# 4. GitHubへアップロード → Vercelへデプロイ

このフォルダ一式を GitHub リポジトリへアップロードし、そのリポジトリを Vercel に Import します。

Framework Preset は **Other** のままで構いません。

Vercel の Project Settings → Environment Variables に次の4つを追加します。

```env
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.6-flash
GAS_WEB_APP_URL=https://script.google.com/macros/s/...../exec
GAS_SHARED_SECRET=setupNumerologyV001で表示された値
```

保存後、Redeploy します。

---

# 5. 動作確認

デプロイしたURLをスマホで開きます。

1. 「カメラで撮影」
2. 手書き鑑定記録を撮る
3. `AIで読み取り中…`
4. 読み取り結果の確認画面
5. 誤読だけ修正
6. 「この内容で確定登録」
7. 「鑑定一覧」で登録結果を確認

原本は Drive の `数秘鑑定_OCR原本_v001` フォルダへ保存されます。

---

# OCR抽出項目（v001）

## 基本情報
- 氏名
- ふりがな（書いてある場合のみ）
- ローマ字
- 生年月日

## 数秘
- 宿命数
- 運命数
- 姓名計算メモ（ローマ字、数字列、小計・合計など）

## 鑑定内容
- 宿命数の説明
- 運命数の説明
- 長所
- 短所
- 愛・恋愛
- 仕事
- 備考
- その他の見出し
- AI全文文字起こし

読みづらい項目は推測で埋めず `uncertain_fields` に回すプロンプトにしています。

---

# スプレッドシート設計

### 人物マスタ
同じ「生年月日 + 氏名またはローマ字」の人物は原則同一人物として再利用します。

### 鑑定記録
1回の鑑定につき1行。宿命数・運命数・元画像・登録方法などを保存します。

### 鑑定詳細
長所、短所、愛、仕事などを縦持ちにしています。将来「健康」「人間関係」等の項目が増えても列追加なしで対応できます。

### OCR受付
画像受付 → AI読取中 → 確認待ち → 確定、という処理履歴を残します。AIエラーもここに記録されます。

---

# v001で意図的に未実装のもの

次フェーズで追加しやすいようDB構造は準備済みですが、v001では以下はまだ入れていません。

- スマホからの完全手入力登録（写真なし）
- スプレッドシート手入力データのアプリへの自動正規化
- 宿命数 / 運命数の計算ロジックによる照合
- 名前からの数秘自動計算
- 鑑定文マスタからの自動生成
- 既存鑑定のアプリ上での編集・削除
- PDF鑑定書出力

---

# トラブル時

### 画面右上が「設定確認」
Vercel の環境変数、GAS Web App URL、GAS_SHARED_SECRET を確認してください。

### `Unauthorized.`
Vercel の `GAS_SHARED_SECRET` と Apps Script のセットアップ時に生成された値が一致していません。

### AIが読まない / Geminiエラー
`GEMINI_API_KEY` と `GEMINI_MODEL` を確認してください。モデル名は環境変数で交換可能です。

### 画像が大きすぎる
ブラウザ側で長辺1800px・JPEGへ圧縮しますが、それでも大きい画像は撮影し直してください。

### Apps Scriptを更新した
Web App のデプロイを「新しいバージョン」で更新してください。
