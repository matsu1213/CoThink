# cothink

cothink は、答えをAIへ委ねず、自分で書きながら考えを明確にする個人用デスクトップメモです。AIはエディタの隣に控えめに存在し、本文を変更せず、分離されたコメントを返します。自発的な介入頻度はユーザーが設定できます。

## セットアップ

必要環境は Node.js 20+、npm 10+、Rust stable、Tauri 2 のOS別ビルド要件です。Windowsでは WebView2 と Visual Studio C++ Build Tools が必要です。

```bash
npm install
npm run dev          # ブラウザ開発モード（Mockネイティブ層）
npm run tauri dev    # デスクトップ開発モード
```

初期設定はAI有効・Mockプロバイダーです。AIを使わない場合は設定画面で「AIレビューを有効にする」をオフにしてください。ノート、検索、コメント、書き出しは引き続き利用できます。選択できるAI経路は Mock、OpenAI API、Codex CLI、Claude Code CLIです。

## OpenAI API（BYOK）

設定画面でプロバイダーを OpenAI に切り替え、APIキーとモデル名を入力します。キーは `localStorage` やSQLiteには入らず、Windows Credential Manager / macOS Keychain / Linux Secret Serviceへ保存されます。開発時のみ、資格情報が未設定なら `OPENAI_API_KEY` 環境変数を参照します。

ChatGPTのサブスクリプションとOpenAI APIの利用・課金は別です。ChatGPTのCookie、セッショントークン、非公式APIは使用しません。APIキーは [OpenAI Platform](https://platform.openai.com/api-keys) で作成してください。

選択範囲レビューはフローティングメニューから直接実行できます。ノート全体レビューだけは実行確認ダイアログを残しています。APIレスポンスは構造化JSONとして検証し、最大5コメントだけ保存します。

AIコンパニオンの割り込み設定は `manual_only` / `gentle` / `proactive` の3段階です。初期値の `gentle` は編集内容をローカルで追跡し、新しい考えが文としてまとまり、前回から十分な変更がある場合だけ直近3ブロックをレビューします。`proactive` はより小さな変更単位で候補を探します。待ち時間タイマーは使わず、未解決候補がある間は追加実行しません。コメントは最初に本文右側の吹き出しマーカーだけを表示し、ユーザーがクリックしたときだけ内容を開きます。

## Codex / Claude Code subscription

設定画面で次のローカルCLI経路を選択できます。cothinkがOAuthトークンやCookieを読み取ることはなく、各CLIが安全に保持している既存ログインをそのまま利用します。

```powershell
# Codex: ChatGPT subscriptionでログイン
codex login
codex login status

# Claude Code: Claude subscriptionでログイン
claude auth login
claude auth status
```

CLIはPATH上に必要です。Codexは `codex exec --ephemeral --sandbox read-only`、Claude Codeは `claude -p --no-session-persistence` で固定実行します。レビュー本文はプロセス引数ではなくstdinだけで渡します。Claude側は組み込みツール、MCP、Chrome連携をすべて無効化し、Codex側は空の隔離ディレクトリ・read-only sandboxでツールを使わない指示を付けます。どちらも構造化スキーマを要求したうえで、cothink側でも再検証します。

CodexではChatGPT workspaceの利用枠と管理ポリシーが適用されます。Claude Codeでは、2026年6月15日以降、subscription上の `claude -p` / Agent SDK利用は対話利用枠とは別の月次Agent SDK creditを消費します。利用可能性やモデルは契約・ワークスペース設定に依存します。

## データ保存先

Tauriのアプリデータディレクトリ（`app.cothink.desktop`）に `cothink.sqlite3` を作成します。Markdown書き出しは同じ場所の `exports/` です。ブラウザ開発モードだけはネイティブAPIの代用品としてノートをブラウザストレージへ保存します。デスクトップ版はSQLiteが正本です。

保存するものはTiptap JSON、派生プレーンテキスト、コメント、リビジョン、AI実行メタデータです。`ai_runs` は入力ハッシュだけを持ち、AIへ送信した本文そのものを保存しません。テレメトリーはありません。

## コマンド

```bash
npm run test          # Vitest
npm run test:e2e      # Playwright（ブラウザMock統合）
npm run lint
npm run typecheck
npm run build         # フロントエンド
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build   # デスクトップ配布物
```

実APIテストは通常スイートに含みません。手動で設定画面の接続テストを使うか、明示的に `OPENAI_API_KEY` を設定した開発環境で確認してください。

## キーボード

- `Ctrl/Cmd+N`: 新規ノート
- `Ctrl/Cmd+K`: 検索へ移動
- `Ctrl/Cmd+Shift+R`: ノート全体レビューの確認を開く
- Tiptap標準のMarkdown編集ショートカット（太字等）
- エディタ右下の顔: 現在の文章からAIへコメント候補を手動で依頼

開発ビルドではAIレビューの開始・終了を標準出力へ記録します。本文、APIキー、生レスポンスは出力せず、プロバイダー、モード、入力文字数、所要時間、コメント件数、分類済みエラーコードだけを記録します。

## MVP上の仮定

- 既存コードのない空リポジトリから開始した。
- デフォルトモデルは品質とコストの均衡を取る `gpt-5.6-terra` とし、`src-tauri/src/ai.rs` の一か所へ集約した。設定画面で変更できる。
- FTS5 `trigram` はbundled SQLiteを使うため利用可能。3文字以上はFTS5、1〜2文字はLIKEへ分岐する。
- ブラウザE2EはUI/Mockプロバイダーの回帰確認、Rust統合テストはSQLiteの永続層を担当する。完全なWebViewプロセス再起動E2Eは今後の課題。

詳細は [ARCHITECTURE.md](./ARCHITECTURE.md)、[PRIVACY.md](./PRIVACY.md)、[CONTRIBUTING.md](./CONTRIBUTING.md)、[TODO.md](./TODO.md) を参照してください。
