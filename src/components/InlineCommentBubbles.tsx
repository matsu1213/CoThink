import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { documentBlocks } from '../lib/document';
import { resolveAnchor } from '../lib/anchor';
import { speechLead } from '../lib/companion';
import { useStore } from '../store';
import type { Comment } from '../types';

type Position = {comment: Comment; top: number; left: number};

function domPoint(root: Element, offset: number): {node: Node; offset: number} | undefined {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let consumed = 0, node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= consumed + length) return {node, offset: Math.max(0, offset - consumed)};
    consumed += length; node = walker.nextNode();
  }
  return undefined;
}

function quoteRect(block: Element, from: number, to: number): DOMRect | undefined {
  const start = domPoint(block, from), end = domPoint(block, to);
  if (!start || !end) return undefined;
  const range = document.createRange();
  range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
  const rects = Array.from(range.getClientRects());
  return rects.at(-1) ?? range.getBoundingClientRect();
}

export function InlineCommentBubbles({openCommentId, onDismiss, onApply, onDeepDive}: {
  openCommentId?: string;
  onDismiss(id: string): void;
  onApply(comment: Comment): void;
  onDeepDive(comment: Comment): void;
}) {
  const comments = useStore(state => state.comments), note = useStore(state => state.active), refresh = useStore(state => state.refreshComments);
  const [positions, setPositions] = useState<Position[]>([]), [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!openCommentId) return;
    const frame = requestAnimationFrame(() => setOpenIds(current => new Set(current).add(openCommentId)));
    return () => cancelAnimationFrame(frame);
  }, [openCommentId]);

  useEffect(() => {
    if (!note) return;
    const pane = document.querySelector('.editor-pane');
    if (!pane) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const paneRect = pane.getBoundingClientRect(), blocks = documentBlocks(JSON.parse(note.bodyJson));
        const measured: Position[] = [];
        for (const comment of comments) {
          if (comment.status !== 'open' || !comment.blockId || comment.anchorFrom == null || comment.anchorTo == null || !comment.quote) continue;
          const anchor = resolveAnchor({blockId: comment.blockId, from: comment.anchorFrom, to: comment.anchorTo, quote: comment.quote, prefix: comment.prefix, suffix: comment.suffix}, blocks);
          if (anchor.orphaned) continue;
          const block = document.querySelector(`[data-block-id="${CSS.escape(anchor.blockId)}"]`);
          if (!block) continue;
          const rect = quoteRect(block, anchor.from, anchor.to) ?? block.getBoundingClientRect();
          if (rect.bottom < paneRect.top || rect.top > paneRect.bottom) continue;
          const rightSide = rect.right + 10 <= paneRect.right - 34;
          measured.push({comment: {...comment, anchorFrom: anchor.from, anchorTo: anchor.to, orphaned: false}, top: rect.top + rect.height / 2 - 14, left: rightSide ? rect.right + 8 : rect.left - 36});
        }
        measured.sort((left, right) => left.top - right.top);
        for (let index = 1; index < measured.length; index += 1) {
          if (measured[index].top < measured[index - 1].top + 32) measured[index].top = measured[index - 1].top + 32;
        }
        setPositions(measured);
      });
    };
    measure();
    pane.addEventListener('scroll', measure, {passive: true});
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure); observer.observe(pane);
    return () => { cancelAnimationFrame(frame); pane.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); observer.disconnect(); };
  }, [comments, note]);

  const toggle = (id: string) => setOpenIds(current => {
    const next = new Set(current);
    if (next.has(id)) { next.delete(id); onDismiss(id); } else next.add(id);
    return next;
  });
  const status = async (comment: Comment, value: 'ignored' | 'resolved') => {
    await api.updateComment(comment.id, value);
    setOpenIds(current => { const next = new Set(current); next.delete(comment.id); return next; });
    onDismiss(comment.id); await refresh();
  };
  const jump = (comment: Comment) => window.dispatchEvent(new CustomEvent('cothink-jump-anchor', {detail: comment}));

  return <div className="inline-comment-layer">
    {positions.map(position => {
      const open = openIds.has(position.comment.id), placeLeft = position.left + 350 > window.innerWidth;
      const cardLeft = placeLeft ? Math.max(12, position.left - 320) : position.left + 36;
      const cardTop = Math.max(62, Math.min(window.innerHeight - 390, position.top - 18));
      return <div key={position.comment.id}>
        <button className={`inline-comment-marker ${position.comment.source}`} style={{top: position.top, left: position.left}} onClick={() => toggle(position.comment.id)} aria-label={`${position.comment.source === 'ai' ? 'AI' : '手動'}コメントを${open ? '閉じる' : '開く'}`} aria-expanded={open}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.8 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/></svg>
        </button>
        {open && <article className="inline-comment-popover" style={{top: cardTop, left: cardLeft}} aria-live="polite">
          <header><span className={`source ${position.comment.source}`}>{position.comment.source === 'ai' ? 'AI' : '手動'}</span><button onClick={() => toggle(position.comment.id)} aria-label="コメントを閉じる">×</button></header>
          <button className="inline-comment-lead" onClick={() => jump(position.comment)}>{speechLead(position.comment, 80)}</button>
          <p>{position.comment.body}</p>
          {position.comment.whyItMatters && <p className="why">なぜ重要か：{position.comment.whyItMatters}</p>}
          {position.comment.question && <p>問い：{position.comment.question}</p>}
          {position.comment.suggestedRewrite && <div className="rewrite"><small>推敲案</small><p>{position.comment.suggestedRewrite}</p><button onClick={() => onApply(position.comment)}>差分を確認して適用</button></div>}
          <footer>{position.comment.source === 'ai' && <button onClick={() => onDeepDive(position.comment)}>深掘り</button>}<button onClick={() => status(position.comment, 'ignored')}>無視</button><button onClick={() => status(position.comment, 'resolved')}>解決</button></footer>
        </article>}
      </div>;
    })}
  </div>;
}
