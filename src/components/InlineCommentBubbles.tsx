import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { documentBlocks } from '../lib/document';
import { inferAnchorFromCommentText, resolveAnchor } from '../lib/anchor';
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

function blockElement(root: Element, blockId: string, from?: number, to?: number, quote?: string, fullText?: string): Element | null {
  const candidates = Array.from(root.querySelectorAll(`[data-block-id="${CSS.escape(blockId)}"]`));
  if (candidates.length < 2) return candidates[0] ?? null;
  if (fullText) {
    const exactBlock = candidates.find(candidate => candidate.textContent === fullText);
    if (exactBlock) return exactBlock;
  }
  if (quote) {
    const exactRange = candidates.find(candidate => from != null && to != null && candidate.textContent?.slice(from, to) === quote);
    if (exactRange) return exactRange;
    const containing = candidates.find(candidate => candidate.textContent?.includes(quote));
    if (containing) return containing;
  }
  return candidates[0] ?? null;
}

export function InlineCommentBubbles({onApply, onDeepDive}: {
  onApply(comment: Comment): void;
  onDeepDive(comment: Comment): void;
}) {
  const comments = useStore(state => state.comments), note = useStore(state => state.active), refresh = useStore(state => state.refreshComments);
  const [positions, setPositions] = useState<Position[]>([]), [openIds, setOpenIds] = useState<Set<string>>(() => new Set()), [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!note) return;
    const pane = document.querySelector('.editor-pane');
    if (!pane) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const editorRoot = pane.querySelector('.tiptap');
        if (!editorRoot) return;
        const paneRect = pane.getBoundingClientRect(), editorRect = editorRoot.getBoundingClientRect(), blocks = documentBlocks(JSON.parse(note.bodyJson));
        const measured: Position[] = [];
        for (const comment of comments) {
          if (comment.status !== 'open') continue;
          let positionedComment = comment, block: Element | null = null, rect: DOMRect | undefined;
          if (comment.blockId && comment.anchorFrom != null && comment.anchorTo != null && comment.quote) {
            const anchor = resolveAnchor({blockId: comment.blockId, from: comment.anchorFrom, to: comment.anchorTo, quote: comment.quote, prefix: comment.prefix, suffix: comment.suffix}, blocks);
            if (!anchor.orphaned) {
              block = blockElement(pane, anchor.blockId, anchor.from, anchor.to, comment.quote);
              if (block) {
                rect = quoteRect(block, anchor.from, anchor.to) ?? block.getBoundingClientRect();
                positionedComment = {...comment, anchorFrom: anchor.from, anchorTo: anchor.to, orphaned: false};
              }
            }
          }
          if (!block) {
            const inferred = inferAnchorFromCommentText([comment.body, comment.question, comment.whyItMatters], blocks, comment.blockId);
            if (inferred) {
              block = blockElement(pane, inferred.blockId, inferred.from, inferred.to, inferred.quote);
              if (block) {
                rect = quoteRect(block, inferred.from, inferred.to) ?? block.getBoundingClientRect();
                positionedComment = {...comment, blockId: inferred.blockId, anchorFrom: inferred.from, anchorTo: inferred.to, quote: inferred.quote, prefix: inferred.prefix, suffix: inferred.suffix, orphaned: false};
              }
            }
          }
          if (!block) {
            const fallback = blocks.find(candidate => candidate.blockId === comment.blockId && candidate.text.trim())
              ?? [...blocks].reverse().find(candidate => candidate.text.trim());
            if (!fallback) continue;
            block = blockElement(pane, fallback.blockId, undefined, undefined, undefined, fallback.text);
            if (!block) continue;
            const from = Math.max(0, fallback.text.search(/\S/u)), quote = fallback.text.slice(from, from + 36).trimEnd();
            positionedComment = {...comment, blockId: fallback.blockId, anchorFrom: from, anchorTo: from + quote.length, quote, orphaned: true};
            rect = block.getBoundingClientRect();
          }
          if (!block) continue;
          const blockRect = block.getBoundingClientRect();
          rect ??= blockRect;
          if (rect.bottom < paneRect.top || rect.top > paneRect.bottom) continue;
          const gutterLeft = Math.min(editorRect.right + 12, paneRect.right - 40);
          measured.push({comment: positionedComment, top: rect.top + rect.height / 2 - 14, left: gutterLeft});
        }
        measured.sort((left, right) => left.top - right.top);
        for (let index = 1; index < measured.length; index += 1) {
          if (measured[index].top < measured[index - 1].top + 32) measured[index].top = measured[index - 1].top + 32;
        }
        setPositions(measured);
      });
    };
    measure();
    document.addEventListener('scroll', measure, {passive: true, capture: true});
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure, {passive: true});
    const observer = new ResizeObserver(measure); observer.observe(pane); observer.observe(pane.querySelector('.tiptap')!);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [comments, note]);

  const toggle = (id: string) => {
    setExpandedIds(current => { const next = new Set(current); next.delete(id); return next; });
    setOpenIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleExpanded = (id: string) => setExpandedIds(current => {
    const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  const status = async (comment: Comment, value: 'ignored' | 'resolved') => {
    await api.updateComment(comment.id, value);
    setOpenIds(current => { const next = new Set(current); next.delete(comment.id); return next; });
    await refresh();
  };
  const jump = (comment: Comment) => window.dispatchEvent(new CustomEvent('Cothink-jump-anchor', {detail: comment}));

  return <div className="inline-comment-layer">
    {positions.map(position => {
      const open = openIds.has(position.comment.id), expanded = expandedIds.has(position.comment.id), placeLeft = position.left + 350 > window.innerWidth;
      const cardLeft = placeLeft ? Math.max(12, position.left - 320) : position.left + 36;
      const cardTop = Math.max(62, Math.min(window.innerHeight - 390, position.top - 18));
      return <div key={position.comment.id}>
        <button className={`inline-comment-marker ${position.comment.source}`} style={{top: position.top, left: position.left}} onClick={() => toggle(position.comment.id)} aria-label={`${position.comment.source === 'ai' ? 'AI' : '手動'}コメントを${open ? '閉じる' : '開く'}`} aria-expanded={open}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.8 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/></svg>
        </button>
        {open && <article className="inline-comment-popover" style={{top: cardTop, left: cardLeft}} aria-live="polite">
          <header><span className={`source ${position.comment.source}`}>{position.comment.source === 'ai' ? 'AI' : '手動'}</span><button onClick={() => toggle(position.comment.id)} aria-label="コメントを閉じる">×</button></header>
          <button className="inline-comment-lead" onClick={() => toggleExpanded(position.comment.id)} aria-expanded={expanded}>{speechLead(position.comment, 80)}</button>
          {expanded ? <div className="inline-comment-detail">
            {position.comment.orphaned && <p className="warning">元の位置を特定できないため、近くに表示しています。</p>}
            <p>{position.comment.body}</p>
            {position.comment.whyItMatters && <p className="why">{position.comment.whyItMatters}</p>}
            {position.comment.question && <p>問い：{position.comment.question}</p>}
            {position.comment.suggestedRewrite && <div className="rewrite"><small>推敲案</small><p>{position.comment.suggestedRewrite}</p>{!position.comment.orphaned && <button onClick={() => onApply(position.comment)}>差分を確認して適用</button>}</div>}
          </div> : <small className="expand-hint">クリックして詳細</small>}
          <button className="inline-comment-jump" onClick={() => jump(position.comment)}>該当箇所</button>
          <footer>{position.comment.source === 'ai' && <button onClick={() => onDeepDive(position.comment)}>深掘り</button>}<button onClick={() => status(position.comment, 'ignored')}>無視</button><button onClick={() => status(position.comment, 'resolved')}>解決</button></footer>
        </article>}
      </div>;
    })}
  </div>;
}
