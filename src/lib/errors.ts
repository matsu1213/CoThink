export const appErrorCodes = [
  'api_key_missing', 'invalid_api_key', 'quota_exceeded', 'network', 'timeout',
  'unsupported_model', 'unsupported_endpoint', 'invalid_api_base_url', 'invalid_ai_output', 'credential_store', 'invalid_provider',
  'ai_disabled', 'empty_input', 'sqlite', 'save_failed', 'cancelled',
  'cli_not_installed', 'cli_not_authenticated', 'cli_failed', 'unknown',
] as const;

export type AppErrorCode = typeof appErrorCodes[number];

export type AppErrorDetails = {
  title: string;
  message: string;
  action?: string;
};

const details: Record<AppErrorCode, AppErrorDetails> = {
  api_key_missing: {title: 'APIキーが未設定です', message: '選択したAPIへ接続するためのキーが見つかりません。', action: '設定でAPIキーを保存してから、もう一度試してください。'},
  invalid_api_key: {title: 'APIキーを確認してください', message: '接続先APIがこのキーを認証できませんでした。', action: 'キーの入力間違いや失効を確認し、必要なら新しいキーを保存してください。'},
  quota_exceeded: {title: 'APIの利用上限に達しました', message: '利用量または課金上限により、レビューを実行できません。', action: 'OpenAI Platformの利用状況と請求設定を確認してください。'},
  network: {title: 'AIサービスへ接続できません', message: 'ネットワーク接続、プロキシ、または一時的なサービス障害の可能性があります。', action: '接続を確認し、少し待ってから再試行してください。'},
  timeout: {title: 'AIの応答に時間がかかっています', message: '制限時間内にレビューが完了しませんでした。', action: '再試行するか、短い範囲を選んでレビューしてください。'},
  unsupported_model: {title: 'モデルを利用できません', message: '指定したモデル名が無効か、このアカウントでは利用できません。', action: '設定で「一覧を更新」し、表示されたモデルを選んでください。'},
  unsupported_endpoint: {title: '互換APIへ接続できません', message: '指定したサーバーにOpenAI互換のAPIが見つかりませんでした。', action: 'ベースURLに /v1 など必要なパスが含まれているか確認してください。'},
  invalid_api_base_url: {title: 'APIベースURLを確認してください', message: 'HTTPSの有効なURLを指定する必要があります。認証情報やクエリはURLに含められません。', action: '例: https://provider.example/v1'},
  invalid_ai_output: {title: 'AIの応答をコメントにできませんでした', message: '返された内容がcothinkのコメント形式と一致しませんでした。', action: '再試行してください。続く場合は別のモデルへ変更してください。'},
  credential_store: {title: 'APIキーを安全に保存できません', message: 'OSの資格情報ストアを利用できませんでした。', action: 'OSの資格情報サービスを確認してから、もう一度保存してください。'},
  invalid_provider: {title: 'AIプロバイダーを利用できません', message: '保存されたプロバイダー設定を読み取れませんでした。', action: '設定でプロバイダーを選び直してください。'},
  ai_disabled: {title: 'AIレビューは無効です', message: '現在の設定ではAIへ接続しません。', action: '利用する場合は設定でAIレビューを有効にしてください。'},
  empty_input: {title: 'レビューする文章がありません', message: 'AIへ渡せる文章が見つかりませんでした。', action: '文章を書いてから、または範囲を選択してから実行してください。'},
  sqlite: {title: 'ローカルデータを読み書きできません', message: 'データベース処理中に問題が発生しました。', action: 'アプリを再起動してください。続く場合はデータファイルの権限と空き容量を確認してください。'},
  save_failed: {title: '保存できませんでした', message: '変更内容をローカルへ保存できませんでした。', action: '空き容量を確認し、アプリを閉じる前に再試行してください。'},
  cancelled: {title: 'キャンセルしました', message: 'AIレビューを中止しました。'},
  cli_not_installed: {title: 'AI CLIが見つかりません', message: '選択したCLIをcothinkから起動できませんでした。', action: 'CLIをインストールしてPATHへ追加し、cothinkを再起動してください。'},
  cli_not_authenticated: {title: 'AI CLIへログインしてください', message: '選択したCLIのログイン情報を利用できませんでした。', action: 'ターミナルでログインを済ませてから再試行してください。'},
  cli_failed: {title: 'AI CLIを実行できませんでした', message: 'CLIがレビューを完了できませんでした。', action: 'CLIの更新、利用状態、モデル名を確認してください。'},
  unknown: {title: 'AI処理に失敗しました', message: '予期しない問題が発生しました。', action: '再試行してください。続く場合は設定の利用状態を確認してください。'},
};

export function errorDetails(code: AppErrorCode): AppErrorDetails { return details[code]; }

export function errorMessage(code: AppErrorCode) {
  const value = errorDetails(code);
  return [value.title, value.message, value.action].filter(Boolean).join(' ');
}

export function errorCode(error: unknown): AppErrorCode {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as {code?: unknown}).code
    : error;
  return typeof code === 'string' && (appErrorCodes as readonly string[]).includes(code)
    ? code as AppErrorCode
    : 'unknown';
}
