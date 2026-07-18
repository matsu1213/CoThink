import { describe, expect, it } from 'vitest';
import { autoReviewAllowed, candidateWindow, GENTLE_COOLDOWN_MS, locateCandidateAnchor, locateDocumentQuoteAnchor, speechLead } from './companion';

const document = {type: 'doc', content: [
  {type: 'paragraph', attrs: {blockId: 'a'}, content: [{type: 'text', text: 'この判断では利用者が毎日使うという前提を置いています。'}]},
  {type: 'paragraph', attrs: {blockId: 'b'}, content: [{type: 'text', text: '一方で利用頻度を確認する調査結果はまだ文章に含まれていません。'}]},
]};

describe('AI companion candidate scan policy', () => {
  it('builds a bounded multi-block window for AI to choose from', () => {
    const window = candidateWindow(document, 40)!;
    expect(window.blocks).toHaveLength(2);
    expect(window.text).toContain('利用頻度');
  });

  it('anchors the exact quote selected by AI', () => {
    const window = candidateWindow(document, 40)!;
    expect(locateCandidateAnchor('利用頻度を確認する調査結果', window)).toMatchObject({blockId: 'b', quote: '利用頻度を確認する調査結果'});
    expect(locateCandidateAnchor('原文に存在しない文', window)).toBeUndefined();
  });

  it('anchors whole-note review quotes for inline bubbles', () => {
    expect(locateDocumentQuoteAnchor(document, '利用者が毎日使うという前提')).toMatchObject({blockId: 'a'});
  });

  it('prevents duplicate, frequent, or overlapping scans', () => {
    const base = {now: GENTLE_COOLDOWN_MS, lastRunAt: 0, cooldownMs: GENTLE_COOLDOWN_MS, signature: 'note:window', hasOpenSuggestion: false};
    expect(autoReviewAllowed(base)).toBe(true);
    expect(autoReviewAllowed({...base, lastSignature: base.signature})).toBe(false);
    expect(autoReviewAllowed({...base, now: GENTLE_COOLDOWN_MS - 1})).toBe(false);
    expect(autoReviewAllowed({...base, hasOpenSuggestion: true})).toBe(false);
  });
});

describe('speechLead', () => {
  it('prefers the short question over the fuller observation', () => {
    expect(speechLead({question: 'これってどういうこと？', body: '長い観察文がここに入ります。'})).toBe('これってどういうこと？');
  });

  it('falls back to the body when there is no question', () => {
    expect(speechLead({body: '短い観察'})).toBe('短い観察');
  });

  it('truncates text longer than maxLength with an ellipsis', () => {
    const long = 'あ'.repeat(50);
    expect(speechLead({body: long}, 10)).toBe(`${'あ'.repeat(10)}…`);
  });
});
