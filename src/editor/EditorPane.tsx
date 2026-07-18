import { useEffect, useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { BlockIdExtension } from './BlockIdExtension';
import { createDebounced } from '../lib/debounce';
import { documentToText, ensureBlockIds } from '../lib/document';
import { api } from '../services/api';
import { useStore } from '../store';
import type { TextSelection } from '../types';

type AnchorEvent = {blockId?: string; quote?: string; anchorFrom?: number; anchorTo?: number; rewrite?: string};

export function EditorPane({onSelection}: {onSelection(value?: TextSelection): void}) {
  const note = useStore(state => state.active);
  const patch = useStore(state => state.patchActive);
  const saved = useStore(state => state.setSaved);
  const setState = useStore(state => state.setSaveState);
  const save = useMemo(() => createDebounced(async () => {
    const current = useStore.getState().active;
    if (!current) return;
    setState('saving');
    try { saved(await api.saveNote({id: current.id, title: current.title, bodyJson: current.bodyJson, bodyText: current.bodyText})); }
    catch { setState('error'); }
  }, 700), [saved, setState]);

  const editor = useEditor({
    extensions: [StarterKit, BlockIdExtension, Placeholder.configure({placeholder: 'ここから考え始める…'})],
    content: note ? JSON.parse(note.bodyJson) : undefined,
    onCreate: ({editor}) => editor.commands.setContent(ensureBlockIds(editor.getJSON())),
    onUpdate: ({editor}) => {
      const json = ensureBlockIds(editor.getJSON());
      patch({bodyJson: JSON.stringify(json), bodyText: documentToText(json)});
      save();
    },
    onSelectionUpdate: ({editor}) => {
      const {from, to} = editor.state.selection;
      if (from === to) { onSelection(undefined); return; }
      const $from = editor.state.doc.resolve(from), $to = editor.state.doc.resolve(to);
      if (!$from.sameParent($to)) { onSelection(undefined); return; }
      const start = $from.start($from.depth), parent = $from.parent;
      const startOffset = from - start, endOffset = to - start;
      const startCoords = editor.view.coordsAtPos(from), endCoords = editor.view.coordsAtPos(to);
      onSelection({
        text: editor.state.doc.textBetween(from, to, ' '),
        blockId: String(parent.attrs.blockId ?? ''),
        from: startOffset,
        to: endOffset,
        prefix: parent.textContent.slice(Math.max(0, startOffset - 24), startOffset),
        suffix: parent.textContent.slice(endOffset, endOffset + 24),
        top: Math.min(startCoords.top, endCoords.top) - 10,
        left: (startCoords.left + endCoords.right) / 2,
      });
    },
  });

  useEffect(() => {
    if (editor && note) { editor.commands.setContent(JSON.parse(note.bodyJson)); editor.commands.focus('end'); onSelection(undefined); }
    // The editor must only reload when note identity changes, not after each body update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, note?.id]);
  useEffect(() => () => save.flush(), [save]);
  useEffect(() => {
    const before = () => save.flush();
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [save]);
  useEffect(() => {
    if (!editor) return;
    const locate = (detail: AnchorEvent) => {
      let found: {from: number; to: number} | undefined;
      editor.state.doc.descendants((node, position) => {
        if (found) return false;
        if (node.attrs.blockId === detail.blockId) {
          const offset = detail.quote ? node.textContent.indexOf(detail.quote) : -1;
          if (offset >= 0) found = {from: position + 1 + offset, to: position + 1 + offset + (detail.quote?.length ?? 0)};
          else if (detail.anchorFrom != null && detail.anchorTo != null) found = {from: position + 1 + detail.anchorFrom, to: position + 1 + detail.anchorTo};
        }
      });
      return found;
    };
    const apply = (event: Event) => {
      const detail = (event as CustomEvent<AnchorEvent>).detail, range = locate(detail);
      if (range && detail.rewrite) editor.chain().focus().insertContentAt(range, detail.rewrite).run();
    };
    const jump = (event: Event) => {
      const detail = (event as CustomEvent<AnchorEvent>).detail, range = locate(detail);
      if (range) {
        editor.chain().focus().setTextSelection(range).scrollIntoView().run();
        document.querySelector(`[data-block-id="${CSS.escape(detail.blockId ?? '')}"]`)?.scrollIntoView({block: 'center'});
      }
    };
    window.addEventListener('cothink-apply-rewrite', apply);
    window.addEventListener('cothink-jump-anchor', jump);
    return () => {
      window.removeEventListener('cothink-apply-rewrite', apply);
      window.removeEventListener('cothink-jump-anchor', jump);
    };
  }, [editor]);

  if (!note) return <main className="empty"><h2>考える場所をつくりましょう</h2><button onClick={() => useStore.getState().create()}>最初のノートを作成</button></main>;
  return <main className="editor-pane">
    <input className="title" aria-label="ノートタイトル" value={note.title} onChange={event => { patch({title: event.target.value}); save(); }}/>
    <div className="toolbar"><button onClick={() => editor?.chain().focus().toggleBold().run()}>太字</button><button onClick={() => editor?.chain().focus().toggleHeading({level: 2}).run()}>見出し</button><button onClick={() => editor?.chain().focus().toggleBulletList().run()}>リスト</button></div>
    <EditorContent editor={editor}/>
  </main>;
}
