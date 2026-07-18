import type { JSONContent } from '@tiptap/core';
import { documentBlocks } from './document';
import type { CommentAnchor } from '../types';

export function speechLead(comment: {question?: string; body: string}, maxLength = 40): string {
  const source = (comment.question?.trim() || comment.body.trim());
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

export const GENTLE_IDLE_MS = 20_000;
export const PROACTIVE_IDLE_MS = 12_000;
export const GENTLE_COOLDOWN_MS = 5 * 60_000;
export const PROACTIVE_COOLDOWN_MS = 3 * 60_000;

type CandidateBlock = {blockId: string; text: string};
export type CandidateWindow = {text: string; blocks: CandidateBlock[]; signature: string};

export function candidateWindow(doc: JSONContent, minimumTotalLength = 80): CandidateWindow | undefined {
  const blocks = documentBlocks(doc)
    .map(block => ({...block, text: block.text.trim()}))
    .filter(block => block.text.length >= 20)
    .slice(-3);
  const text = blocks.map(block => block.text).join('\n\n');
  if (text.length < minimumTotalLength) return undefined;
  return {text, blocks, signature: blocks.map(block => `${block.blockId}:${block.text}`).join('|')};
}

export function locateCandidateAnchor(targetQuote: string | undefined, window: CandidateWindow): CommentAnchor | undefined {
  const quote = targetQuote?.trim();
  if (!quote) return undefined;
  for (const block of window.blocks) {
    const from = block.text.indexOf(quote);
    if (from < 0) continue;
    return {
      blockId: block.blockId,
      from,
      to: from + quote.length,
      quote,
      prefix: block.text.slice(Math.max(0, from - 24), from),
      suffix: block.text.slice(from + quote.length, from + quote.length + 24),
    };
  }
  return undefined;
}

export function autoReviewAllowed(input: {
  now: number;
  lastRunAt: number;
  cooldownMs: number;
  signature: string;
  lastSignature?: string;
  hasOpenSuggestion: boolean;
}) {
  return !input.hasOpenSuggestion
    && input.signature !== input.lastSignature
    && input.now - input.lastRunAt >= input.cooldownMs;
}
