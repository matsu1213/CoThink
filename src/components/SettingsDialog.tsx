import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { errorCode, type AppErrorCode } from '../lib/errors';
import { AIErrorNotice } from './AIErrorNotice';
import { useStore } from '../store';
import type { AIProviderKind, InterruptionMode } from '../types';
import { defaultModels, OPENAI_BASE_URL, resolveModel } from '../lib/models';

const interruptionModes: {value: InterruptionMode; title: string; description: string}[] = [
  {value: 'manual_only', title: '手動のみ', description: '選択メニューや全体レビューを操作したときだけAIを呼びます。'},
  {value: 'gentle', title: '控えめ', description: '書いた内容を追い、大きな変化がまとまったときだけ吹き出しで知らせます。'},
  {value: 'proactive', title: '積極的', description: '書いた内容を追い、短めのまとまりごとに重要な候補を1件だけ探します。'},
];

export function SettingsDialog({onClose}: {onClose(): void}) {
  const current = useStore(state => state.settings)!;
  const [enabled, setEnabled] = useState(current.enabled);
  const [provider, setProvider] = useState(current.provider);
  const [model, setModel] = useState(current.model);
  const [apiBaseUrl, setApiBaseUrl] = useState(current.apiBaseUrl);
  const [interruptionMode, setInterruptionMode] = useState(current.interruptionMode);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<AppErrorCode>();
  const [models, setModels] = useState<string[]>([]), [modelsLoading, setModelsLoading] = useState(false);
  const cli = provider === 'codex_cli' || provider === 'claude_cli';

  const loadModels = useCallback(async (selectedProvider: AIProviderKind, surfaceResult = false) => {
    setModelsLoading(true);
    try {
      const available = await api.listModels(selectedProvider);
      setModels([...new Set([resolveModel(selectedProvider, model), ...available])]);
      if (surfaceResult) { setError(undefined); setMessage(`${available.length}件のモデルを取得しました。`); }
    } catch (loadError) {
      setModels([resolveModel(selectedProvider, model)]);
      if (surfaceResult) { setMessage(''); setError(errorCode(loadError)); }
    } finally { setModelsLoading(false); }
  }, [model]);

  useEffect(() => {
    if ((provider === 'openai' || provider === 'openai_compatible') && (!current.hasApiKey || current.provider !== provider)) return;
    void loadModels(provider);
    // Provider changes are the refresh boundary; custom model typing must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, current.hasApiKey]);

  const changeProvider = (next: AIProviderKind) => {
    setProvider(next); setModel(defaultModels[next]); setApiBaseUrl(next === 'openai' ? OPENAI_BASE_URL : next === 'openai_compatible' ? '' : ''); setModels([]); setMessage(''); setError(undefined);
  };
  const save = async () => {
    try {
      const settings = await api.saveSettings({enabled, provider, model, apiBaseUrl, interruptionMode, apiKey: apiKey || undefined});
      useStore.setState({settings}); setError(undefined);
      setMessage(provider === 'openai' || provider === 'openai_compatible' ? '設定を保存しました。APIキーはOS資格情報ストアへ保存されます。' : cli ? '設定を保存しました。CLIの既存ログインを利用し、認証情報はcothinkへ保存しません。' : '設定を保存しました。外部サービスには送信しません。');
      return true;
    } catch (saveError) { setMessage(''); setError(errorCode(saveError)); return false; }
  };
  const test = async () => {
    if (!await save()) return;
    try { await api.testConnection(); setError(undefined); setMessage('接続できました。この設定でAIレビューを利用できます。'); }
    catch (testError) { setMessage(''); setError(errorCode(testError)); }
  };

  return <div className="modal"><div className="dialog settings">
    <header><h2>設定</h2><button onClick={onClose} aria-label="設定を閉じる">×</button></header>
    <label className="check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>AIレビューを有効にする</label>
    <fieldset className="interruption-settings" disabled={!enabled}>
      <legend>AIからの声のかけ方</legend>
      {interruptionModes.map(mode => <label key={mode.value} className={interruptionMode === mode.value ? 'interruption active' : 'interruption'}>
        <input type="radio" name="interruption" value={mode.value} checked={interruptionMode === mode.value} onChange={() => setInterruptionMode(mode.value)}/>
        <span><strong>{mode.title}</strong><small>{mode.description}</small></span>
      </label>)}
      {interruptionMode !== 'manual_only' && <p className="privacy-note">待ち時間ではなく文の区切りと変更量で判断します。未解決の候補がある間は追加実行しません。</p>}
    </fieldset>
    <label>プロバイダー<select value={provider} onChange={event => changeProvider(event.target.value as AIProviderKind)}><option value="mock">Mock（外部送信なし）</option><option value="openai">OpenAI API（BYOK）</option><option value="openai_compatible">OpenAI互換API（BYOK）</option><option value="codex_cli">Codex CLI（ChatGPT subscription）</option><option value="claude_cli">Claude Code CLI（Claude subscription）</option></select></label>
    {provider === 'openai_compatible' && <label>APIベースURL<input type="url" inputMode="url" spellCheck={false} placeholder="https://provider.example/v1" value={apiBaseUrl} onChange={event => setApiBaseUrl(event.target.value)}/><small>HTTPSのOpenAI互換APIを指定します。cothinkは <code>/models</code> と <code>/chat/completions</code> を呼び出します。</small></label>}
    <label>モデル<div className="model-picker"><input aria-label="モデル名" value={model} onChange={event => setModel(event.target.value)}/><button type="button" disabled={modelsLoading || ((provider === 'openai' || provider === 'openai_compatible') && (!current.hasApiKey || current.provider !== provider))} onClick={() => void loadModels(provider, true)}>{modelsLoading ? '取得中…' : '一覧を更新'}</button><select className="model-options" aria-label="利用可能なモデル一覧" value="" disabled={models.length === 0} onChange={event => event.target.value && setModel(event.target.value)}><option value="">{models.length ? `候補から選択（${models.length}件）` : '利用可能なモデルを取得してください'}</option>{models.map(available => <option key={available} value={available}>{available}</option>)}</select></div><small>入力中のモデル名にかかわらず、取得した候補をすべて表示します。{provider === 'codex_cli' ? ' Codex CLIのログイン中アカウントで利用可能なモデルを取得します。' : provider === 'openai' || provider === 'openai_compatible' ? ' 設定を保存後、Models APIから利用可能なモデルを取得できます。' : provider === 'claude_cli' ? ' Claude Codeのモデル名または別名（通常は sonnet）も直接入力できます。' : ''}</small></label>
    {(provider === 'openai' || provider === 'openai_compatible') && <label>{provider === 'openai' ? 'OpenAI APIキー' : '互換プロバイダーのAPIキー'}<input type="password" autoComplete="off" placeholder={current.provider === provider && current.hasApiKey ? '保存済み（変更時のみ入力）' : 'APIキー'} value={apiKey} onChange={event => setApiKey(event.target.value)}/><small>キーはこのプロバイダー専用の項目としてOS資格情報ストアへ保存します。</small></label>}
    {provider === 'openai' && <p className="muted">開発時は未保存の場合に限り OPENAI_API_KEY も参照します。</p>}
    {provider === 'openai_compatible' && <p className="muted">開発時は未保存の場合に限り OPENAI_COMPATIBLE_API_KEY も参照します。APIキーはベースURLごとに分けて保存されます。</p>}
    {cli && <div className="cli-notice"><p>{provider === 'codex_cli' ? '`codex login` 済みのCodex CLI' : '`claude auth login` 済みのClaude Code CLI'}がPATH上に必要です。cothinkは固定した非対話コマンドだけを実行します。</p><p className="muted">レビュー本文はstdinからCLIへ渡され、各サービスへ外部送信されます。CLIセッションは保存しません。</p></div>}
    {error && <AIErrorNotice code={error}/>} {message && <p className="success-notice" role="status">{message}</p>}
    <footer><button onClick={() => void save()}>保存</button><button className="primary" onClick={() => void test()}>利用状態を確認</button></footer>
  </div></div>;
}
