# Architecture

## 境界

```text
React / Tiptap / Zustand
  └─ services/api.ts（型付きアプリAPI）
       └─ Tauri commands
            ├─ db.rs: Notes / Revisions / Comments / FTS5 / AI run metadata
            ├─ ai.rs: Mock / OpenAI Responses API / output validation
            ├─ cli_ai.rs: Codex / Claude Code fixed headless subprocesses
            ├─ keyring: OS credential store
            └─ export_markdown: app-data/exports only
```

ReactコンポーネントはSQLite、OS資格情報、OpenAIエンドポイントへ直接アクセスしない。ブラウザ開発モードの `browserApi` は高速なUI開発・E2E用の同一インターフェース実装であり、本番Tauriではコンパイル時にではなくランタイム検出でネイティブ実装を選ぶ。

## 本文とアンカー

Tiptap JSONが本文の正本で、`body_text` は検索と送信用の派生値。paragraph、heading、blockquote、codeBlock、listItemへ `blockId` グローバル属性を付ける。アンカーは `blockId/from/to/quote/prefix/suffix` を保存し、位置一致→同一ブロックquote→前後文脈→orphanedの順で復元する。orphanedコメントは削除せずパネルに残す。

推敲案はコメントとして保存し、ユーザーが変更前後の確認ダイアログで承認した場合だけTiptap transactionを発行する。AIレスポンスが本文へ直接触れる経路はない。

## 保存と検索

編集は700ms debounceし、終了前にflushを試みる。保存はトランザクションで、直近と異なる本文かつ5分以上経過した場合にリビジョンを作る。大量の同一リビジョンを避ける。SQLiteはWALと外部キーを有効化する。

3文字以上の検索はFTS5 trigramとBM25を使いタイトルを8倍に重み付けし、タイトル一致、BM25、更新日時の順に並べる。1〜2文字はLIKEでタイトル一致と更新日時を優先する。

## AIプロバイダー

UI公開型は `ReviewRequest` / `AICommentDraft`。ネイティブ層で Mock、OpenAI API、Codex CLI、Claude Code CLIを交換する。すべて同じ構造化コメント契約をRustとUI双方で検証する。入力はSHA-256ハッシュのみ `ai_runs` に記録し、本文は記録しない。実行中はリクエストIDごとのキャンセル通知でHTTPまたは子プロセスfutureを破棄できる。

選択レビュー、コンパニオン、従来の全体確認ダイアログは同じ `api.review` と `create_comment` を共有する。割り込みモードは既存の `app_settings` に `ai_interruption_mode` として保存するためスキーマ追加は不要。自発レビューは静止後、直近の最大3ブロックからなる有界な候補ウィンドウをAIへ渡し、AIに原文の `targetQuote` を選ばせる。返された引用がブロック内で完全一致した場合だけアンカー付き候補として保存する。コメントUIは右パネルを持たず、解決済みアンカーからDOM Rangeを測定して引用末尾の横へ複数の吹き出しマーカーを配置する。同一行のマーカーは衝突回避で縦にずらし、スクロールとリサイズ時に再測定する。未解決候補、同一内容、クールダウン中は自発レビューを実行しない。

CLI経路はユーザー入力を実行ファイル名や引数へ展開しない。実行可能ファイルは `codex` / `claude`、引数はコード内の許可済み固定値で、本文はstdinだけに渡す。子プロセスはWindows `CREATE_NO_WINDOW`、stdout/stderr pipe、120秒timeout、1MB出力上限、drop時killで実行する。Codexはephemeral/read-only/ignore-user-config、Claudeはsafe-mode/no-session-persistence/tools disabled/strict MCPで動作する。CLIの生stderrや本文はログ・UIへ返さず、分類済みエラーコードだけを返す。

プロンプトは `src-tauri/src/ai.rs` の `SYSTEM_PROMPT`、実行メタデータの `prompt_version='v1'` で管理する。意味を変える際は文字列を更新し、DBへ保存するバージョンを `v2` のように増やし、変更理由をPRへ記載する。

## セキュリティ

Tauri capabilityは `core:default` だけで、shell/plugin/http権限は付与しない。ネイティブCLI連携も任意shellを公開せず、固定バイナリと固定引数だけをRustから直接spawnする。CSPは外部URLを許可しない。OpenAI API通信はRust `reqwest` の固定 `https://api.openai.com` だけ。MarkdownはHTMLへ展開してDOMへ挿入せず、Tiptap JSONから生成する。書き出し先はアプリデータ配下へ固定し、任意パスは受け取らない。
