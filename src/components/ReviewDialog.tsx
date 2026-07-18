import { useRef, useState } from 'react';
import { api } from '../services/api';
import { errorMessage, type AppErrorCode } from '../lib/errors';
import { useStore } from '../store';
import type { ReviewMode } from '../types';

const labels: Record<ReviewMode, string> = {concretize: '具体化', assumptions: '前提を疑う', logic: '論理を確認', counterpoint: '反対意見', essence: '本質を抽出', polish: '表現を推敲'};

export function ReviewDialog({onClose}: {onClose(): void}) {
  const note = useStore(state => state.active)!;
  const settings = useStore(state => state.settings), refresh = useStore(state => state.refreshComments);
  const abort = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<ReviewMode>('concretize'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const run = async () => {
    abort.current = new AbortController(); setBusy(true); setError('');
    try {
      const drafts = await api.review({noteId: note.id, mode, fullText: note.bodyText}, abort.current.signal);
      for (const draft of drafts) await api.createComment({noteId: note.id, source: 'ai', commentType: draft.type, body: draft.observation, whyItMatters: draft.whyItMatters, question: draft.question, suggestedRewrite: draft.suggestedRewrite, confidence: draft.confidence, quote: draft.targetQuote});
      await refresh(); onClose();
    } catch (reviewError) { setError(errorMessage(((reviewError as {code?: AppErrorCode}).code ?? 'unknown'))); }
    finally { setBusy(false); }
  };
  if (!settings?.enabled) return <div className="modal"><div className="dialog"><h2>AIは無効です</h2><p>設定からAIプロバイダーを有効にできます。</p><button onClick={onClose}>閉じる</button></div></div>;
  return <div className="modal"><div className="dialog"><header><h2>ノート全体をレビュー</h2><button onClick={onClose} aria-label="閉じる">×</button></header><p>レビュー方法を選んで実行します。</p><label>レビュー方法<select value={mode} onChange={event => setMode(event.target.value as ReviewMode)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{error && <p className="error">{error}</p>}<footer>{busy ? <><button onClick={() => abort.current?.abort()}>キャンセル</button><span>確認中…</span></> : <button className="primary" disabled={!note.bodyText} onClick={run}>レビューを実行</button>}</footer></div></div>;
}
