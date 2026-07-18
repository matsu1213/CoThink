import type { JSONContent } from '@tiptap/core';
import { documentBlocks } from './document';
import type { CommentAnchor } from '../types';

export function speechLead(comment: {question?: string; body: string}, maxLength = 40): string {
  const source = (comment.question?.trim() || comment.body.trim());
  return source.length > maxLength ? `${source.slice(0, maxLength)}…` : source;
}

export const GENTLE_CHANGE_CHARS = 96;
export const PROACTIVE_CHANGE_CHARS = 48;

type CandidateBlock = {blockId: string; text: string};
export type CandidateWindow = {text: string; blocks: CandidateBlock[]; signature: string};

function normalizedTextWithOffsets(value: string) {
  let text = '', sourceOffset = 0;
  const starts: number[] = [], ends: number[] = [];
  for (const sourceCharacter of value) {
    const sourceEnd = sourceOffset + sourceCharacter.length;
    for (const normalizedCharacter of sourceCharacter.normalize('NFKC')) {
      if (!/\s/u.test(normalizedCharacter)) {
        text += normalizedCharacter;
        starts.push(sourceOffset); ends.push(sourceEnd);
      }
    }
    sourceOffset = sourceEnd;
  }
  return {text, starts, ends};
}

function normalizedQuote(value: string) {
  return value
    .trim()
    .replace(/^[「『“"']+|[」』”"']+$/gu, '')
    .normalize('NFKC')
    .replace(/\s/gu, '');
}

function locateNormalizedQuote(text: string, quote: string): {from: number; to: number} | undefined {
  const normalized = normalizedTextWithOffsets(text), needle = normalizedQuote(quote);
  if (!needle) return undefined;
  const at = normalized.text.indexOf(needle);
  if (at < 0) return undefined;
  return {from: normalized.starts[at], to: normalized.ends[at + needle.length - 1]};
}

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
  const quote = targetQuote?.trim().replace(/^[「『“"']+|[」』”"']+$/gu, '');
  if (!quote) return undefined;
  for (const block of window.blocks) {
    const exactFrom = block.text.indexOf(quote), normalizedRange = exactFrom < 0 ? locateNormalizedQuote(block.text, quote) : undefined;
    const from = exactFrom >= 0 ? exactFrom : normalizedRange?.from;
    const to = exactFrom >= 0 ? exactFrom + quote.length : normalizedRange?.to;
    if (from == null || to == null) continue;
    const resolvedQuote = block.text.slice(from, to);
    return {
      blockId: block.blockId,
      from,
      to,
      quote: resolvedQuote,
      prefix: block.text.slice(Math.max(0, from - 24), from),
      suffix: block.text.slice(to, to + 24),
    };
  }
  return undefined;
}

export function fallbackCandidateAnchor(window: CandidateWindow): CommentAnchor | undefined {
  const block = [...window.blocks].reverse().find(candidate => candidate.text.trim());
  if (!block) return undefined;
  const from = block.text.search(/\S/u), quote = block.text.slice(Math.max(0, from), Math.max(0, from) + 36).trimEnd();
  if (!quote) return undefined;
  const to = Math.max(0, from) + quote.length;
  return {blockId: block.blockId, from: Math.max(0, from), to, quote, suffix: block.text.slice(to, to + 24)};
}

export function locateDocumentQuoteAnchor(doc: JSONContent, targetQuote: string | undefined): CommentAnchor | undefined {
  const blocks = documentBlocks(doc);
  const window = {text: blocks.map(block => block.text).join('\n\n'), blocks, signature: ''};
  return locateCandidateAnchor(targetQuote, window) ?? fallbackCandidateAnchor(window);
}

function changedCharacterCount(previous: string | undefined, next: string): number {
  if (!previous) return next.length;
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) suffix += 1;
  return Math.max(previous.length - prefix - suffix, next.length - prefix - suffix);
}

export function liveReviewAllowed(input: {
  text: string;
  lastReviewedText?: string;
  minChangedCharacters: number;
  hasOpenSuggestion: boolean;
}) {
  const reachesThoughtBoundary = /[。！？!?]\s*$/.test(input.text);
  return !input.hasOpenSuggestion
    && reachesThoughtBoundary
    && changedCharacterCount(input.lastReviewedText, input.text) >= input.minChangedCharacters;
}
