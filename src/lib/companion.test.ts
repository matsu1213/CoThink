import { describe, expect, it } from 'vitest';
import { candidateWindow, fallbackCandidateAnchor, GENTLE_CHANGE_CHARS, liveReviewAllowed, locateCandidateAnchor, locateDocumentQuoteAnchor, speechLead } from './companion';

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

  it('anchors a quote despite whitespace, width, and wrapping quote differences', () => {
    const window = candidateWindow({type: 'doc', content: [{type: 'paragraph', attrs: {blockId: 'a'}, content: [{type: 'text', text: 'ＡＩ と  一緒に考える。その過程を大切にしたい。'}]}]}, 10)!;
    expect(locateCandidateAnchor('「AIと一緒に考える。」', window)).toMatchObject({blockId: 'a', quote: 'ＡＩ と  一緒に考える。'});
  });

  it('falls back to a real block when AI returns an unusable quote', () => {
    const window = candidateWindow(document, 40)!;
    expect(fallbackCandidateAnchor(window)).toMatchObject({blockId: 'b'});
  });

  it('anchors whole-note review quotes for inline bubbles', () => {
    expect(locateDocumentQuoteAnchor(document, '利用者が毎日使うという前提')).toMatchObject({blockId: 'a'});
  });

  it('tracks edits immediately but only sends meaningful completed changes', () => {
    const text = `${'考えを続けています'.repeat(12)}。`;
    const base = {text, minChangedCharacters: GENTLE_CHANGE_CHARS, hasOpenSuggestion: false};
    expect(liveReviewAllowed(base)).toBe(true);
    expect(liveReviewAllowed({...base, lastReviewedText: text})).toBe(false);
    expect(liveReviewAllowed({...base, text: text.slice(0, -1)})).toBe(false);
    expect(liveReviewAllowed({...base, hasOpenSuggestion: true})).toBe(false);
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
