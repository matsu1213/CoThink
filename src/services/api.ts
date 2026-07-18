import { invoke } from '@tauri-apps/api/core';
import type {
  AICommentDraft,
  AISettings,
  Comment,
  Note,
  ReviewRequest,
  SearchResult,
} from '../types';
import { defaultModels, resolveModel } from '../lib/models';

const native = '__TAURI_INTERNALS__' in window;
const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args);

export interface AppApi {
  listNotes(): Promise<Note[]>;
  createNote(): Promise<Note>;
  saveNote(note: Pick<Note, 'id' | 'title' | 'bodyJson' | 'bodyText'>): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  searchNotes(query: string): Promise<SearchResult[]>;
  listComments(noteId: string): Promise<Comment[]>;
  createComment(input: Partial<Comment> & Pick<Comment, 'noteId' | 'source' | 'commentType' | 'body'>): Promise<Comment>;
  updateComment(id: string, status: Comment['status']): Promise<Comment>;
  settings(): Promise<AISettings>;
  saveSettings(settings: Omit<AISettings, 'hasApiKey'> & {apiKey?: string}): Promise<AISettings>;
  testConnection(): Promise<void>;
  listModels(provider: AISettings['provider']): Promise<string[]>;
  review(request: ReviewRequest, signal?: AbortSignal): Promise<AICommentDraft[]>;
  exportMarkdown(noteId: string, markdown: string): Promise<string>;
}

const nativeApi: AppApi = {
  listNotes: () => call('list_notes'),
  createNote: () => call('create_note'),
  saveNote: note => call('save_note', {note}),
  deleteNote: id => call('delete_note', {id}),
  searchNotes: query => call('search_notes', {query}),
  listComments: noteId => call('list_comments', {noteId}),
  createComment: input => call('create_comment', {input}),
  updateComment: (id, status) => call('update_comment', {id, status}),
  settings: () => call('get_ai_settings'),
  saveSettings: settings => call('save_ai_settings', {settings}),
  testConnection: () => call('test_ai_connection'),
  listModels: provider => call('list_ai_models', {provider}),
  review: (request, signal) => {
    const requestId = crypto.randomUUID();
    if (signal?.aborted) return Promise.reject({code: 'cancelled'});
    signal?.addEventListener('abort', () => { void call('cancel_ai_review', {requestId}); }, {once: true});
    return call('review_note', {request, requestId});
  },
  exportMarkdown: (noteId, markdown) => call('export_markdown', {noteId, markdown}),
};

const key = 'Cothink.dev.v1';
type DevDb = {notes: Note[]; comments: Comment[]; settings: AISettings};
const initialSettings: AISettings = {
  enabled: true,
  provider: 'mock',
  model: 'mock-v1',
  apiBaseUrl: '',
  hasApiKey: false,
  interruptionMode: 'gentle',
};
const load = (): DevDb => {
  const raw = localStorage.getItem(key);
  if (!raw) return {notes: [], comments: [], settings: initialSettings};
  const db = JSON.parse(raw) as DevDb;
  db.settings = {...initialSettings, ...db.settings};
  db.settings.model = resolveModel(db.settings.provider, db.settings.model);
  return db;
};
const store = (db: DevDb) => localStorage.setItem(key, JSON.stringify(db));
const now = () => new Date().toISOString();

const browserApi: AppApi = {
  async listNotes() { return load().notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
  async createNote() {
    const db = load(), timestamp = now();
    const note: Note = {
      id: crypto.randomUUID(), title: '無題のノート',
      bodyJson: JSON.stringify({type: 'doc', content: [{type: 'paragraph', attrs: {blockId: crypto.randomUUID()}}]}),
      bodyText: '', createdAt: timestamp, updatedAt: timestamp,
    };
    db.notes.unshift(note); store(db); return note;
  },
  async saveNote(note) {
    const db = load(), old = db.notes.find(item => item.id === note.id);
    if (!old) throw {code: 'save_failed'};
    Object.assign(old, note, {updatedAt: now()}); store(db); return old;
  },
  async deleteNote(id) {
    const db = load();
    db.notes = db.notes.filter(note => note.id !== id);
    db.comments = db.comments.filter(comment => comment.noteId !== id);
    store(db);
  },
  async searchNotes(query) {
    const q = query.toLocaleLowerCase();
    return load().notes.filter(note => `${note.title} ${note.bodyText}`.toLocaleLowerCase().includes(q)).map(note => ({
      note,
      snippet: note.bodyText.slice(Math.max(0, note.bodyText.toLocaleLowerCase().indexOf(q) - 24), 120),
    }));
  },
  async listComments(noteId) { return load().comments.filter(comment => comment.noteId === noteId); },
  async createComment(input) {
    const db = load(), timestamp = now();
    const comment = {id: crypto.randomUUID(), whyItMatters: '', status: 'open', orphaned: false, createdAt: timestamp, updatedAt: timestamp, ...input} as Comment;
    db.comments.push(comment); store(db); return comment;
  },
  async updateComment(id, status) {
    const db = load(), comment = db.comments.find(item => item.id === id);
    if (!comment) throw {code: 'sqlite'};
    comment.status = status; comment.updatedAt = now(); store(db); return comment;
  },
  async settings() { return load().settings; },
  async saveSettings(settings) {
    const db = load();
    const {apiKey, ...safeSettings} = settings;
    db.settings = {...safeSettings, model: resolveModel(settings.provider, settings.model), hasApiKey: Boolean(apiKey) || db.settings.hasApiKey};
    store(db); return db.settings;
  },
  async testConnection() {
    const settings = load().settings;
    if ((settings.provider === 'openai' || settings.provider === 'openai_compatible') && !settings.hasApiKey) throw {code: 'api_key_missing'};
    if (settings.provider === 'openai_compatible' && !settings.apiBaseUrl.startsWith('https://')) throw {code: 'invalid_api_base_url'};
    if (settings.provider === 'codex_cli' || settings.provider === 'claude_cli') throw {code: 'cli_not_installed'};
  },
  async listModels(provider) {
    return provider === 'claude_cli' ? ['sonnet', 'opus', 'haiku'] : provider === 'openai_compatible' ? [] : [defaultModels[provider]];
  },
  async review(request, signal) {
    const settings = load().settings;
    if (settings.provider === 'codex_cli' || settings.provider === 'claude_cli') throw {code: 'cli_not_installed'};
    await new Promise((resolve, reject) => {
      const id = setTimeout(resolve, 500);
      signal?.addEventListener('abort', () => { clearTimeout(id); reject({code: 'cancelled'}); }, {once: true});
    });
    const text = request.selectedText || request.fullText || '';
    const targetQuote = request.candidateScan
      ? text.split(/\r?\n/).filter(Boolean).at(-1)?.trim().slice(0, 40)
      : text.slice(0, 80);
    const focus = request.candidateScan ? targetQuote || text : text;
    const tone = focus.length % 11;
    return [{
      targetQuote,
      type: request.mode === 'polish' ? 'wording' : request.mode === 'assumptions' ? 'assumption' : request.mode === 'logic' ? 'logic_gap' : request.mode === 'counterpoint' ? 'counterpoint' : request.mode === 'essence' ? 'essence' : 'ambiguity',
      observation: tone === 1
        ? `「${focus.slice(0, 28)}${focus.length > 28 ? '…' : ''}」って迷う感じ、わかる。`
        : `「${focus.slice(0, 28)}${focus.length > 28 ? '…' : ''}」の基準、もう少し一緒に見たい。`,
      whyItMatters: '読み手が異なる基準で解釈すると、同じ結論に到達できない可能性があります。',
      question: tone === 0 ? 'ここで大事にしてる基準って何？' : undefined,
      suggestedRewrite: request.mode === 'polish' && text ? `${text}（判断基準を具体化する）` : undefined,
      confidence: .82,
    }];
  },
  async exportMarkdown(noteId, markdown) {
    const blob = new Blob([markdown], {type: 'text/markdown'}), url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${noteId}.md`; anchor.click(); URL.revokeObjectURL(url); return anchor.download;
  },
};

export const api: AppApi = native ? nativeApi : browserApi;
