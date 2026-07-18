import { describe, expect, it } from 'vitest';
import { inferAnchorFromCommentText, resolveAnchor } from './anchor';

describe('resolveAnchor', () => {
  it('uses exact position first', () => expect(resolveAnchor({blockId: 'b', from: 2, to: 5, quote: 'abc'}, [{blockId: 'b', text: '--abc'}]).orphaned).toBe(false));

  it('recovers moved quote with context', () => expect(resolveAnchor({blockId: 'b', from: 0, to: 3, quote: '対象', prefix: '前', suffix: '後'}, [{blockId: 'b', text: '対象 x 前対象後'}])).toMatchObject({from: 6, to: 8, orphaned: false}));

  it('recovers a quote moved into another block', () => expect(resolveAnchor(
    {blockId: 'old', from: 0, to: 5, quote: '大切な箇所'},
    [{blockId: 'new', text: '段落を分割して大切な箇所をこちらへ移した。'}],
  )).toMatchObject({blockId: 'new', orphaned: false}));

  it('recovers whitespace and width changes', () => expect(resolveAnchor(
    {blockId: 'b', from: 0, to: 6, quote: 'AIと考える'},
    [{blockId: 'b', text: 'ＡＩ と  考える'}],
  )).toMatchObject({from: 0, to: 9, orphaned: false}));

  it('infers an old missing anchor from a quoted comment excerpt', () => expect(inferAnchorFromCommentText(
    ['「この判断は正しい…」って少し気になる。'],
    [{blockId: 'b', text: '前置き。この判断は正しいと思っている。'}],
  )).toMatchObject({blockId: 'b', quote: 'この判断は正しい'}));

  it('infers an anchor from a sufficiently long shared phrase without quotation marks', () => expect(inferAnchorFromCommentText(
    ['利用者の頻度を確認する部分、少し気になる。'],
    [{blockId: 'b', text: 'まず利用者の頻度を確認する部分を整理しておきたい。'}],
  )).toMatchObject({blockId: 'b'}));

  it('keeps broken anchors as orphaned', () => expect(resolveAnchor({blockId: 'missing', from: 0, to: 1, quote: 'x'}, []).orphaned).toBe(true));
});
