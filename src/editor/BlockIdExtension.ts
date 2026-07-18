import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const blockTypes = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem']);

export const BlockIdExtension = Extension.create({
  name: 'blockId',
  addGlobalAttributes() {
    return [{
      types: [...blockTypes],
      attributes: {
        blockId: {
          default: null,
          parseHTML: element => element.getAttribute('data-block-id'),
          renderHTML: attributes => attributes.blockId ? {'data-block-id': attributes.blockId} : {},
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some(transaction => transaction.docChanged)) return null;
        const seen = new Set<string>();
        const transaction = newState.tr;
        let changed = false;
        newState.doc.descendants((node, position) => {
          if (!blockTypes.has(node.type.name)) return;
          const current = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : '';
          const blockId = current && !seen.has(current) ? current : crypto.randomUUID();
          seen.add(blockId);
          if (blockId === current) return;
          transaction.setNodeMarkup(position, undefined, {...node.attrs, blockId});
          changed = true;
        });
        return changed ? transaction : null;
      },
    })];
  },
});
