import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { EditorPane } from './editor/EditorPane';
import { InlineCommentBubbles } from './components/InlineCommentBubbles';
import { ReviewDialog } from './components/ReviewDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { SelectionReviewMenu } from './components/SelectionReviewMenu';
import { AICompanion } from './components/AICompanion';
import { api } from './services/api';
import { documentToMarkdown } from './lib/document';
import { autoReviewAllowed, candidateWindow, GENTLE_COOLDOWN_MS, GENTLE_IDLE_MS, locateCandidateAnchor, PROACTIVE_COOLDOWN_MS, PROACTIVE_IDLE_MS, type CandidateWindow } from './lib/companion';
import { errorMessage, type AppErrorCode } from './lib/errors';
import { useStore } from './store';
import type { Comment, CommentAnchor, CompanionState, ReviewMode, TextSelection } from './types';

export function App() {
  const load = useStore(state => state.load), note = useStore(state => state.active);
  const saveState = useStore(state => state.saveState), settingsValue = useStore(state => state.settings);
  const comments = useStore(state => state.comments), refresh = useStore(state => state.refreshComments);
  const [selection, setSelection] = useState<TextSelection>();
  const [wholeReview, setWholeReview] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const [intro, setIntro] = useState(() => !localStorage.getItem('cothink.intro'));
  const [busy, setBusy] = useState(false);
  const [openCommentId, setOpenCommentId] = useState<string>();
  const [reviewError, setReviewError] = useState('');
  const abort = useRef<AbortController | undefined>(undefined);
  const lastAutoRun = useRef(0), lastAutoSignature = useRef<string | undefined>(undefined);
  const settings = settingsValue;
  const latestOpenAI = [...comments]
    .filter(comment => comment.source === 'ai' && comment.status === 'open')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void useStore.getState().create(); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); document.getElementById('note-search')?.focus(); }
      if (event.shiftKey && event.key.toLowerCase() === 'r' && note) { event.preventDefault(); setWholeReview(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [note]);
  useEffect(() => {
    setOpenCommentId(undefined); setReviewError('');
  }, [note?.id]);

  const runReview = useCallback(async (target: CommentAnchor, mode: ReviewMode, importantOnly = false) => {
    if (!note || !settings?.enabled || busy) return;
    abort.current = new AbortController();
    setBusy(true); setReviewError('');
    try {
      let drafts = await api.review({noteId: note.id, mode, selectedText: target.quote, surroundingText: `${target.prefix ?? ''}[選択]${target.suffix ?? ''}`}, abort.current.signal);
      if (importantOnly) drafts = drafts.sort((left, right) => (right.confidence ?? .5) - (left.confidence ?? .5)).filter(draft => (draft.confidence ?? .5) >= .7).slice(0, 1);
      const created: Comment[] = [];
      for (const draft of drafts) created.push(await api.createComment({
        noteId: note.id, source: 'ai', commentType: draft.type, body: draft.observation,
        whyItMatters: draft.whyItMatters, question: draft.question, suggestedRewrite: draft.suggestedRewrite,
        confidence: draft.confidence, blockId: target.blockId, anchorFrom: target.from, anchorTo: target.to,
        quote: target.quote, prefix: target.prefix, suffix: target.suffix,
      }));
      await refresh();
      if (created[0]) setOpenCommentId(created[0].id);
    } catch (error) {
      const code = (error as {code?: AppErrorCode}).code ?? 'unknown';
      if (code !== 'cancelled') setReviewError(errorMessage(code));
    } finally { setBusy(false); }
  }, [busy, note, refresh, settings?.enabled]);

  const scanCandidates = useCallback(async (window: CandidateWindow, reveal: boolean) => {
    if (!note || !settings?.enabled || busy) return;
    abort.current = new AbortController();
    setBusy(true);
    try {
      const drafts = await api.review({noteId: note.id, mode: 'logic', selectedText: window.text, candidateScan: true}, abort.current.signal);
      const candidate = drafts
        .sort((left, right) => (right.confidence ?? .5) - (left.confidence ?? .5))
        .filter(draft => (draft.confidence ?? .5) >= .65)
        .map(draft => ({draft, anchor: locateCandidateAnchor(draft.targetQuote, window)}))
        .find(item => item.anchor);
      if (!candidate?.anchor) return;
      const created = await api.createComment({
        noteId: note.id, source: 'ai', commentType: candidate.draft.type, body: candidate.draft.observation,
        whyItMatters: candidate.draft.whyItMatters, question: candidate.draft.question,
        suggestedRewrite: candidate.draft.suggestedRewrite, confidence: candidate.draft.confidence,
        blockId: candidate.anchor.blockId, anchorFrom: candidate.anchor.from, anchorTo: candidate.anchor.to,
        quote: candidate.anchor.quote, prefix: candidate.anchor.prefix, suffix: candidate.anchor.suffix,
      });
      await refresh();
      setOpenCommentId(reveal ? created.id : undefined);
    } catch {
      // Automatic scans stay quiet; manual review continues to surface errors.
    } finally { setBusy(false); }
  }, [busy, note, refresh, settings?.enabled]);

  useEffect(() => {
    if (!note || !settings?.enabled || settings.interruptionMode === 'manual_only' || busy) return;
    const candidate = candidateWindow(JSON.parse(note.bodyJson));
    if (!candidate) return;
    const delay = settings.interruptionMode === 'gentle' ? GENTLE_IDLE_MS : PROACTIVE_IDLE_MS;
    const timer = window.setTimeout(() => {
      const signature = `${note.id}:${candidate.signature}`;
      const cooldownMs = settings.interruptionMode === 'gentle' ? GENTLE_COOLDOWN_MS : PROACTIVE_COOLDOWN_MS;
      if (!autoReviewAllowed({now: Date.now(), lastRunAt: lastAutoRun.current, cooldownMs, signature, lastSignature: lastAutoSignature.current, hasOpenSuggestion: Boolean(latestOpenAI || busy)})) return;
      lastAutoRun.current = Date.now(); lastAutoSignature.current = signature;
      void scanCandidates(candidate, settings.interruptionMode === 'proactive');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [note, settings?.enabled, settings?.interruptionMode, busy, latestOpenAI, scanCandidates]);

  const manualComment = async () => {
    if (!note || !selection) return;
    const body = prompt('この範囲へのコメント');
    if (!body) return;
    await api.createComment({noteId: note.id, source: 'manual', commentType: 'note', body, blockId: selection.blockId, anchorFrom: selection.from, anchorTo: selection.to, quote: selection.text, prefix: selection.prefix, suffix: selection.suffix});
    await refresh();
  };
  const apply = (comment: Comment) => {
    if (comment.suggestedRewrite && confirm(`変更前:\n${comment.quote ?? ''}\n\n変更後:\n${comment.suggestedRewrite}\n\nこの変更を適用しますか？`)) {
      window.dispatchEvent(new CustomEvent('cothink-apply-rewrite', {detail: {blockId: comment.blockId, quote: comment.quote, rewrite: comment.suggestedRewrite}}));
    }
  };
  const deepDive = (comment: Comment) => {
    if (!comment.blockId || comment.anchorFrom == null || comment.anchorTo == null || !comment.quote) return;
    void runReview({blockId: comment.blockId, from: comment.anchorFrom, to: comment.anchorTo, quote: comment.quote, prefix: comment.prefix, suffix: comment.suffix}, 'assumptions');
  };
  const reviewSelection = (mode: ReviewMode) => {
    if (!selection) return;
    const target: CommentAnchor = {...selection, quote: selection.text};
    setSelection(undefined); void runReview(target, mode);
  };
  const companionState: CompanionState = !settings?.enabled ? 'muted' : busy ? 'thinking' : latestOpenAI ? 'hasSuggestion' : 'idle';

  return <div className="app">
    <Sidebar/>
    <section className="workspace">
      <nav><span className={`save ${saveState}`}>{saveState === 'saved' ? '保存済み' : saveState === 'dirty' ? '未保存' : saveState === 'saving' ? '保存中…' : '保存失敗'}</span><div>
        <button disabled={!selection} onClick={manualComment}>＋ コメント</button>
        <button disabled={!note} className="whole-review-button" onClick={() => setWholeReview(true)}>ノート全体をレビュー</button>
        <button disabled={!note} onClick={() => note && api.exportMarkdown(note.id, documentToMarkdown(JSON.parse(note.bodyJson)))}>書き出し</button>
        <button onClick={() => setSettingsOpen(true)}>設定</button>
      </div></nav>
      <div className="content"><EditorPane onSelection={setSelection}/></div>
    </section>
    {selection && settings?.enabled && <SelectionReviewMenu selection={selection} busy={busy} onReview={reviewSelection}/>} 
    {note && <InlineCommentBubbles openCommentId={openCommentId} onDismiss={id => setOpenCommentId(current => current === id ? undefined : current)} onApply={apply} onDeepDive={deepDive}/>} 
    {note && <AICompanion state={companionState} error={reviewError} onCancel={() => abort.current?.abort()}/>}
    {wholeReview && note && <ReviewDialog onClose={() => setWholeReview(false)}/>} 
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}/>} 
    {intro && <div className="modal"><div className="dialog intro"><p className="eyebrow">Welcome to cothink</p><h1>答えを委ねず、考えを深める。</h1><p>書くのはあなたです。文章を選ぶと、その場でAIへ問いかけられます。初期設定では、入力が止まった後にAIがコメント候補を探し、見つかったときだけ控えめに合図します。</p><button className="primary" onClick={() => { localStorage.setItem('cothink.intro', '1'); setIntro(false); }}>はじめる</button></div></div>}
  </div>;
}
