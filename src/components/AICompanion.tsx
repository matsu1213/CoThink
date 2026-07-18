import { useEffect, useState } from 'react';
import { speechLead } from '../lib/companion';
import type { Comment, CompanionState } from '../types';

const AWARE_STATES: CompanionState[] = ['hasSuggestion', 'speaking'];

function Face({state}: {state: CompanionState}) {
  if (state === 'speaking') {
    return <svg viewBox="0 0 40 40" role="img" aria-label={`AIコンパニオン: ${state}`}>
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1.7"/>
      <circle cx="15" cy="17" r="1.5" fill="currentColor"/><circle cx="25" cy="17" r="1.5" fill="currentColor"/>
      <ellipse cx="20" cy="25" rx="3.6" ry="2.8" fill="currentColor"/>
    </svg>;
  }
  const mouth = state === 'hasSuggestion' ? 'M14 23 Q20 27 26 23' : state === 'thinking' ? 'M16 24 H24' : 'M15 24 Q20 22 25 24';
  return <svg viewBox="0 0 40 40" role="img" aria-label={`AIコンパニオン: ${state}`}>
    <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1.7"/>
    <circle cx="15" cy="17" r="1.5" fill="currentColor"/><circle cx="25" cy="17" r="1.5" fill="currentColor"/>
    <path d={mouth} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
  </svg>;
}

export function AICompanion({state, comment, visible, origin, error, onToggle, onCancel, onJump, onDeepDive, onStatus, onApply}: {
  state: CompanionState;
  comment?: Comment;
  visible: boolean;
  origin: 'manual' | 'auto';
  error?: string;
  onToggle(): void;
  onCancel(): void;
  onJump(comment: Comment): void;
  onDeepDive(comment: Comment): void;
  onStatus(comment: Comment, status: 'ignored' | 'resolved'): void;
  onApply(comment: Comment): void;
}) {
  const [expanded, setExpanded] = useState(false);
  // The companion remounts (see the `key` in App.tsx) whenever a new AI comment becomes
  // the latest one, so "just arrived in an aware state" is exactly the mount condition here.
  const [perk, setPerk] = useState(() => AWARE_STATES.includes(state));
  useEffect(() => {
    if (!perk) return;
    const timer = window.setTimeout(() => setPerk(false), 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const short = comment && speechLead(comment);
  return <div className={`ai-companion ${state}`}>
    {visible && comment && <section className={`companion-bubble${origin === 'auto' ? ' interrupted' : ''}`} aria-live="polite">
      <button className="bubble-close" onClick={onToggle} aria-label="吹き出しを閉じる">×</button>
      <button className="bubble-lead" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>{short}</button>
      {expanded && <div className="bubble-detail">
        <p>{comment.body}</p>
        {comment.whyItMatters && <p className="why">なぜ重要か：{comment.whyItMatters}</p>}
        {comment.suggestedRewrite && <div className="rewrite"><small>推敲案</small><p>{comment.suggestedRewrite}</p><button onClick={() => onApply(comment)}>差分を確認して適用</button></div>}
      </div>}
      <footer>
        {!comment.orphaned && comment.blockId && <button onClick={() => onJump(comment)}>該当箇所</button>}
        <button onClick={() => onDeepDive(comment)}>深掘り</button>
        <button onClick={() => onStatus(comment, 'ignored')}>無視</button>
        <button onClick={() => onStatus(comment, 'resolved')}>解決</button>
      </footer>
      {!expanded && <small className="expand-hint">クリックして詳細</small>}
    </section>}
    {error && <div className="companion-error" role="alert">{error}</div>}
    <button className={`companion-face${perk ? ' perk' : ''}`} onClick={state === 'thinking' ? onCancel : onToggle} disabled={state === 'muted'} aria-label={state === 'thinking' ? 'AIレビューをキャンセル' : state === 'hasSuggestion' ? 'AIの気づきを見る' : 'AIコンパニオン'}>
      <Face state={state}/>
      {state === 'hasSuggestion' && <span className="suggestion-badge">…</span>}
      {state === 'thinking' && <span className="thinking-mark">考え中</span>}
    </button>
  </div>;
}
