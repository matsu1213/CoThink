import { useState } from 'react';
import { api } from '../services/api';
import { errorMessage, type AppErrorCode } from '../lib/errors';
import { useStore } from '../store';
import type { AIProviderKind, InterruptionMode } from '../types';

const defaults: Record<AIProviderKind, string> = {
  mock: 'mock-v1', openai: 'gpt-5.6-terra', codex_cli: 'gpt-5.6', claude_cli: 'sonnet',
};
const interruptionModes: {value: InterruptionMode; title: string; description: string}[] = [
  {value: 'manual_only', title: '手動のみ', description: '選択メニューや全体レビューを操作したときだけAIを呼びます。'},
  {value: 'gentle', title: '控えめ', description: '入力が20秒止まった後にAIが候補を探し、見つかった場合は「…」だけで知らせます。'},
  {value: 'proactive', title: '積極的', description: '入力が12秒止まった後にAIが候補を探し、重要な指摘を1件だけ表示します。'},
];

export function SettingsDialog({onClose}: {onClose(): void}) {
  const current = useStore(state => state.settings)!;
  const [enabled, setEnabled] = useState(current.enabled);
  const [provider, setProvider] = useState(current.provider);
  const [model, setModel] = useState(current.model);
  const [interruptionMode, setInterruptionMode] = useState(current.interruptionMode);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const cli = provider === 'codex_cli' || provider === 'claude_cli';

  const changeProvider = (next: AIProviderKind) => {
    setProvider(next); setModel(defaults[next]); setMessage('');
  };
  const save = async () => {
    const settings = await api.saveSettings({enabled, provider, model, interruptionMode, apiKey: apiKey || undefined});
    useStore.setState({settings});
    setMessage(provider === 'openai' ? '設定を保存しました。APIキーはOS資格情報ストアへ保存されます。' : cli ? '設定を保存しました。CLIの既存ログインを利用し、認証情報はcothinkへ保存しません。' : '設定を保存しました。外部サービスには送信しません。');
  };
  const test = async () => {
    try { await save(); await api.testConnection(); setMessage('利用可能です。'); }
    catch (error) { setMessage(errorMessage(((error as {code?: AppErrorCode}).code ?? 'unknown'))); }
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
      {interruptionMode !== 'manual_only' && <p className="privacy-note">未解決の候補がある間は追加実行せず、同じ内容を繰り返しレビューしません。</p>}
    </fieldset>
    <label>プロバイダー<select value={provider} onChange={event => changeProvider(event.target.value as AIProviderKind)}><option value="mock">Mock（外部送信なし）</option><option value="openai">OpenAI API（BYOK）</option><option value="codex_cli">Codex CLI（ChatGPT subscription）</option><option value="claude_cli">Claude Code CLI（Claude subscription）</option></select></label>
    <label>モデル<input value={model} onChange={event => setModel(event.target.value)}/><small>{provider === 'codex_cli' ? 'Codexで利用可能なモデル名。通常は gpt-5.6。' : provider === 'claude_cli' ? 'Claude Codeのモデル名または別名。通常は sonnet。' : 'プロバイダーへ渡すモデル名。'}</small></label>
    {provider === 'openai' && <label>OpenAI APIキー<input type="password" autoComplete="off" placeholder={current.hasApiKey ? '保存済み（変更時のみ入力）' : 'sk-…'} value={apiKey} onChange={event => setApiKey(event.target.value)}/><small>ChatGPTの契約とは別に、OpenAI APIのキーが必要です。</small></label>}
    {provider === 'openai' && <p className="muted">開発時は未保存の場合に限り OPENAI_API_KEY も参照します。</p>}
    {cli && <div className="cli-notice"><p>{provider === 'codex_cli' ? '`codex login` 済みのCodex CLI' : '`claude auth login` 済みのClaude Code CLI'}がPATH上に必要です。cothinkは固定した非対話コマンドだけを実行します。</p><p className="muted">レビュー本文はstdinからCLIへ渡され、各サービスへ外部送信されます。CLIセッションは保存しません。</p></div>}
    {message && <p>{message}</p>}
    <footer><button onClick={save}>保存</button><button className="primary" onClick={test}>利用状態を確認</button></footer>
  </div></div>;
}
