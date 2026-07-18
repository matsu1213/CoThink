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
import { candidateWindow, fallbackCandidateAnchor, GENTLE_CHANGE_CHARS, liveReviewAllowed, locateCandidateAnchor, PROACTIVE_CHANGE_CHARS, type CandidateWindow } from './lib/companion';
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
  const [reviewError, setReviewError] = useState('');
  const abort = useRef<AbortController | undefined>(undefined);
  const lastReviewedText = useRef<string | undefined>(undefined);
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
    lastReviewedText.current = undefined; setReviewError('');
  }, [note?.id]);

  const runReview = useCallback(async (target: CommentAnchor, mode: ReviewMode, importantOnly = false) => {
    if (!note || !settings?.enabled || busy) return;
    abort.current = new AbortController();
    setBusy(true); setReviewError('');
    try {
      let drafts = await api.review({noteId: note.id, mode, selectedText: target.quote, surroundingText: `${target.prefix ?? ''}[選択]${target.suffix ?? ''}`}, abort.current.signal);
      if (importantOnly) drafts = drafts.sort((left, right) => (right.confidence ?? .5) - (left.confidence ?? .5)).filter(draft => (draft.confidence ?? .5) >= .7).slice(0, 1);
      for (const draft of drafts) await api.createComment({
        noteId: note.id, source: 'ai', commentType: draft.type, body: draft.observation,
        whyItMatters: draft.whyItMatters, question: draft.question, suggestedRewrite: draft.suggestedRewrite,
        confidence: draft.confidence, blockId: target.blockId, anchorFrom: target.from, anchorTo: target.to,
        quote: target.quote, prefix: target.prefix, suffix: target.suffix,
      });
      await refresh();
    } catch (error) {
      const code = (error as {code?: AppErrorCode}).code ?? 'unknown';
      if (code !== 'cancelled') setReviewError(errorMessage(code));
    } finally { setBusy(false); }
  }, [busy, note, refresh, settings?.enabled]);

  const scanCandidates = useCallback(async (window: CandidateWindow, quiet = true) => {
    if (!note || !settings?.enabled || busy) return;
    abort.current = new AbortController();
    setBusy(true);
    try {
      const drafts = await api.review({noteId: note.id, mode: 'logic', selectedText: window.text, candidateScan: true}, abort.current.signal);
      const candidate = drafts
        .sort((left, right) => (right.confidence ?? .5) - (left.confidence ?? .5))
        .filter(draft => (draft.confidence ?? .5) >= .65)
        .map(draft => ({draft, anchor: locateCandidateAnchor(draft.targetQuote, window) ?? fallbackCandidateAnchor(window)}))
        .find(item => item.anchor);
      if (!candidate?.anchor) return;
      await api.createComment({
        noteId: note.id, source: 'ai', commentType: candidate.draft.type, body: candidate.draft.observation,
        whyItMatters: candidate.draft.whyItMatters, question: candidate.draft.question,
        suggestedRewrite: candidate.draft.suggestedRewrite, confidence: candidate.draft.confidence,
        blockId: candidate.anchor.blockId, anchorFrom: candidate.anchor.from, anchorTo: candidate.anchor.to,
        quote: candidate.anchor.quote, prefix: candidate.anchor.prefix, suffix: candidate.anchor.suffix,
      });
      await refresh();
    } catch (error) {
      if (!quiet) setReviewError(errorMessage(((error as {code?: AppErrorCode}).code ?? 'unknown')));
    } finally { setBusy(false); }
  }, [busy, note, refresh, settings?.enabled]);

  useEffect(() => {
    if (!note || !settings?.enabled || settings.interruptionMode === 'manual_only' || busy) return;
    const candidate = candidateWindow(JSON.parse(note.bodyJson));
    if (!candidate) return;
    const minChangedCharacters = settings.interruptionMode === 'gentle' ? GENTLE_CHANGE_CHARS : PROACTIVE_CHANGE_CHARS;
    if (!liveReviewAllowed({text: candidate.text, lastReviewedText: lastReviewedText.current, minChangedCharacters, hasOpenSuggestion: Boolean(latestOpenAI || busy)})) return;
    lastReviewedText.current = candidate.text;
    void scanCandidates(candidate);
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
  const requestCompanionComment = () => {
    if (!note || busy) return;
    const candidate = candidateWindow(JSON.parse(note.bodyJson), 20);
    if (!candidate) { setReviewError('コメントを考えるために、もう少し文章を書いてください。'); return; }
    void scanCandidates(candidate, false);
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
    {note && <InlineCommentBubbles onApply={apply} onDeepDive={deepDive}/>}
    {note && <AICompanion state={companionState} error={reviewError} onCancel={() => abort.current?.abort()} onRequest={requestCompanionComment}/>}
    {wholeReview && note && <ReviewDialog onClose={() => setWholeReview(false)}/>} 
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)}/>} 
    {intro && <div className="modal"><div className="dialog intro"><p className="eyebrow">Welcome to cothink</p><h1>答えを委ねず、考えを深める。</h1><p>書くのはあなたです。文章を選ぶと、その場でAIへ話しかけられます。初期設定では、書かれた内容を静かに追い、まとまった考えにだけ控えめな吹き出しを添えます。</p><button className="primary" onClick={() => { localStorage.setItem('cothink.intro', '1'); setIntro(false); }}>はじめる</button></div></div>}
  </div>;
}
