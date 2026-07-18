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

選択レビュー、コンパニオン、従来の全体確認ダイアログは同じ `api.review` と `create_comment` を共有する。割り込みモードは既存の `app_settings` に `ai_interruption_mode` として保存するためスキーマ追加は不要。自発レビューは停止時間を待たず、編集をローカルで追跡し、文末と前回解析からの変更文字数を低コストな発火条件にする。AIへは直近の最大3ブロックだけを渡し、原文の `targetQuote` を選ばせる。返された引用がブロック内で完全一致した場合だけアンカー付き候補として保存する。コメントUIは右パネルを持たず、解決済みアンカーからDOM Rangeで縦位置を測定し、エディタ右側の予約ガターへ複数の吹き出しマーカーを配置する。任意のスクロール要素をcaptureで監視して再測定し、同じ高さのマーカーは衝突回避で縦にずらす。未解決候補がある間は自発レビューを実行しない。生成直後は吹き出しマーカーだけを表示し、内容と詳細理由はユーザー操作で開く。

デバッグビルドのTauriコマンド層はAIレビューの開始・終了を標準出力へ構造化風の1行ログとして出す。本文、APIキー、生レスポンスはログ対象外で、プロバイダー、モデル、モード、スコープ、入力文字数、候補探索フラグ、所要時間、結果件数または分類済みエラーコードだけを記録する。

モデル名はプロバイダー別の具体的な既定値へ解決する。OpenAI APIとCodex CLIの既定値は `gpt-5.6-terra` とし、旧設定値 `gpt-5.6` も同じ値へ互換変換する。利用可能モデルの取得はTauriコマンドを経由し、OpenAIは公式 `/v1/models`、Codex CLIはapp-serverの `model/list` を使用する。Claude Codeは安定したモデル一覧APIがないため、既定エイリアスと手入力を使う。

CLI経路はユーザー入力を実行ファイル名や引数へ展開しない。実行可能ファイルは `codex` / `claude`、引数はコード内の許可済み固定値で、本文はstdinだけに渡す。子プロセスはWindows `CREATE_NO_WINDOW`、stdout/stderr pipe、120秒timeout、1MB出力上限、drop時killで実行する。Codexはephemeral/read-only/ignore-user-config、Claudeはsafe-mode/no-session-persistence/tools disabled/strict MCPで動作する。CLIの生stderrや本文はログ・UIへ返さず、分類済みエラーコードだけを返す。

プロンプトは `src-tauri/src/ai.rs` の `SYSTEM_PROMPT`、実行メタデータの `prompt_version='v3'` で管理する。v3では「静かな友人」の短い口調、質問を必要時だけ使うこと、まれな共感、全文または抜粋の明示的な区切りを導入した。意味を変える際は文字列と保存バージョンを同時に更新する。

## セキュリティ

Tauri capabilityは `core:default` だけで、shell/plugin/http権限は付与しない。ネイティブCLI連携も任意shellを公開せず、固定バイナリと固定引数だけをRustから直接spawnする。CSPは外部URLを許可しない。OpenAI API通信はRust `reqwest` の固定 `https://api.openai.com` だけ。MarkdownはHTMLへ展開してDOMへ挿入せず、Tiptap JSONから生成する。書き出し先はアプリデータ配下へ固定し、任意パスは受け取らない。
