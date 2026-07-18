import type { CommentAnchor } from '../types';

export type TextBlock = {blockId: string; text: string};
export type ResolvedAnchor = {blockId: string; from: number; to: number; orphaned: boolean};

type Range = {from: number; to: number};

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
    .replace(/[.…]{1,3}$/u, '')
    .normalize('NFKC')
    .replace(/\s/gu, '');
}

function quoteRanges(text: string, quote: string): Range[] {
  const ranges: Range[] = [];
  let at = text.indexOf(quote);
  while (at >= 0) {
    ranges.push({from: at, to: at + quote.length});
    at = text.indexOf(quote, at + 1);
  }
  if (ranges.length) return ranges;

  const normalized = normalizedTextWithOffsets(text), needle = normalizedQuote(quote);
  if (!needle) return ranges;
  let normalizedAt = normalized.text.indexOf(needle);
  while (normalizedAt >= 0) {
    ranges.push({from: normalized.starts[normalizedAt], to: normalized.ends[normalizedAt + needle.length - 1]});
    normalizedAt = normalized.text.indexOf(needle, normalizedAt + 1);
  }
  return ranges;
}

function contextScore(block: TextBlock, range: Range, anchor: CommentAnchor) {
  const prefix = anchor.prefix && block.text.slice(Math.max(0, range.from - anchor.prefix.length), range.from) === anchor.prefix ? 2 : 0;
  const suffix = anchor.suffix && block.text.slice(range.to, range.to + anchor.suffix.length) === anchor.suffix ? 2 : 0;
  const proximity = block.blockId === anchor.blockId ? Math.max(0, 1 - Math.abs(range.from - anchor.from) / 1000) : 0;
  return prefix + suffix + proximity;
}

export function locateQuoteAnchor(quote: string, blocks: TextBlock[], preferredBlockId?: string): CommentAnchor | undefined {
  const ordered = preferredBlockId
    ? [...blocks.filter(block => block.blockId === preferredBlockId), ...blocks.filter(block => block.blockId !== preferredBlockId)]
    : blocks;
  for (const block of ordered) {
    const range = quoteRanges(block.text, quote)[0];
    if (!range) continue;
    const resolvedQuote = block.text.slice(range.from, range.to);
    return {
      blockId: block.blockId,
      from: range.from,
      to: range.to,
      quote: resolvedQuote,
      prefix: block.text.slice(Math.max(0, range.from - 24), range.from),
      suffix: block.text.slice(range.to, range.to + 24),
    };
  }
  return undefined;
}

export function inferAnchorFromCommentText(texts: Array<string | undefined>, blocks: TextBlock[], preferredBlockId?: string): CommentAnchor | undefined {
  const candidates: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of [/「([^」]{4,120})」/gu, /『([^』]{4,120})』/gu, /“([^”]{4,120})”/gu, /"([^"\n]{4,120})"/gu]) {
      for (const match of text.matchAll(pattern)) candidates.push(match[1]);
    }
  }
  const quoted = candidates
    .sort((left, right) => right.length - left.length)
    .map(candidate => locateQuoteAnchor(candidate, blocks, preferredBlockId))
    .find((anchor): anchor is CommentAnchor => Boolean(anchor));
  if (quoted) return quoted;

  const orderedBlocks = preferredBlockId
    ? [...blocks.filter(block => block.blockId === preferredBlockId), ...blocks.filter(block => block.blockId !== preferredBlockId)]
    : blocks;
  let best: {block: TextBlock; from: number; to: number; length: number} | undefined;
  for (const text of texts) {
    if (!text) continue;
    const commentText = normalizedQuote(text).slice(0, 240);
    for (const block of orderedBlocks) {
      const normalizedBlock = normalizedTextWithOffsets(block.text);
      let previous = new Uint16Array(normalizedBlock.text.length + 1);
      for (let commentIndex = 1; commentIndex <= commentText.length; commentIndex += 1) {
        const current = new Uint16Array(normalizedBlock.text.length + 1);
        for (let blockIndex = 1; blockIndex <= normalizedBlock.text.length; blockIndex += 1) {
          if (commentText[commentIndex - 1] !== normalizedBlock.text[blockIndex - 1]) continue;
          current[blockIndex] = previous[blockIndex - 1] + 1;
          const length = current[blockIndex];
          if (length >= 10 && (!best || length > best.length)) {
            best = {
              block,
              from: normalizedBlock.starts[blockIndex - length],
              to: normalizedBlock.ends[blockIndex - 1],
              length,
            };
          }
        }
        previous = current;
      }
    }
  }
  if (!best) return undefined;
  return {
    blockId: best.block.blockId,
    from: best.from,
    to: best.to,
    quote: best.block.text.slice(best.from, best.to),
    prefix: best.block.text.slice(Math.max(0, best.from - 24), best.from),
    suffix: best.block.text.slice(best.to, best.to + 24),
  };
}

export function resolveAnchor(anchor: CommentAnchor, blocks: TextBlock[]): ResolvedAnchor {
  const originalBlock = blocks.find(block => block.blockId === anchor.blockId);
  if (originalBlock && originalBlock.text.slice(anchor.from, anchor.to) === anchor.quote) {
    return {blockId: originalBlock.blockId, from: anchor.from, to: anchor.to, orphaned: false};
  }

  const candidates = blocks.flatMap(block => quoteRanges(block.text, anchor.quote).map(range => ({block, range})));
  if (!candidates.length) return {blockId: anchor.blockId, from: anchor.from, to: anchor.to, orphaned: true};
  candidates.sort((left, right) => contextScore(right.block, right.range, anchor) - contextScore(left.block, left.range, anchor));
  const best = candidates[0];
  return {blockId: best.block.blockId, from: best.range.from, to: best.range.to, orphaned: false};
}
