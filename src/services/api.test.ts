import { beforeEach, describe, expect, it } from 'vitest';
import { api } from './api';

describe('browser service integration', () => {
  beforeEach(() => localStorage.clear());
  it('creates, saves and restores a note', async () => {
    const note = await api.createNote();
    await api.saveNote({...note, title: '復元するノート', bodyText: '保存済み'});
    expect((await api.listNotes())[0]).toMatchObject({title: '復元するノート', bodyText: '保存済み'});
  });
  it('branches short Japanese searches', async () => {
    const note = await api.createNote();
    await api.saveNote({...note, title: '思考', bodyText: '日本語を検索する'});
    expect(await api.searchNotes('日本')).toHaveLength(1);
  });
  it('turns a Mock review into structured comments', async () => {
    const note = await api.createNote();
    const drafts = await api.review({noteId: note.id, selectedText: '使いやすい', mode: 'concretize'});
    expect(drafts[0].observation).toContain('使いやすい');
    const comment = await api.createComment({noteId: note.id, source: 'ai', commentType: drafts[0].type, body: drafts[0].observation});
    expect((await api.listComments(note.id))[0].id).toBe(comment.id);
  });
  it('uses AI output to nominate an exact candidate quote', async () => {
    const note = await api.createNote();
    const drafts = await api.review({noteId: note.id, selectedText: '最初の段落には前提があります。\n次の段落には検証されていない結論があります。', mode: 'logic', candidateScan: true});
    expect(drafts[0].targetQuote).toContain('次の段落');
  });
  it('defaults to gentle and persists the interruption mode', async () => {
    expect((await api.settings()).interruptionMode).toBe('gentle');
    const current = await api.settings();
    await api.saveSettings({...current, interruptionMode: 'proactive'});
    expect((await api.settings()).interruptionMode).toBe('proactive');
  });
  it('works without an API key in mock mode', async () => expect(api.testConnection()).resolves.toBeUndefined());
});
