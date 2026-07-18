import type { CompanionState } from '../types';

function Face({state}: {state: CompanionState}) {
  const mouth = state === 'thinking' ? 'M16 24 H24' : state === 'hasSuggestion' ? 'M14 23 Q20 27 26 23' : 'M15 24 Q20 22 25 24';
  return <svg viewBox="0 0 40 40" role="img" aria-label={`AIコンパニオン: ${state}`}><circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1.7"/><circle cx="15" cy="17" r="1.5" fill="currentColor"/><circle cx="25" cy="17" r="1.5" fill="currentColor"/><path d={mouth} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>;
}

export function AICompanion({state, error, onCancel, onRequest}: {state: CompanionState; error?: string; onCancel(): void; onRequest(): void}) {
  return <div className={`ai-companion ${state}`}>
    {error && <div className="companion-error" role="alert">{error}</div>}
    {state === 'thinking' ? <button className="companion-face" onClick={onCancel} aria-label="AIレビューをキャンセル"><Face state={state}/><span className="thinking-mark">考え中</span></button> : <button className="companion-face" onClick={onRequest} disabled={state === 'muted'} aria-label="AIにコメントを求める"><Face state={state}/></button>}
  </div>;
}
