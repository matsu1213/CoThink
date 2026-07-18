import type { JSONContent } from '@tiptap/core';

export const emptyDocument = (): JSONContent => ({type: 'doc', content: [{type: 'paragraph', attrs: {blockId: crypto.randomUUID()}}]});
const blocks = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem']);

export function ensureBlockIds(doc: JSONContent): JSONContent {
  const seen = new Set<string>();
  const visit = (node: JSONContent): JSONContent => {
    let attrs = node.attrs;
    if (blocks.has(node.type ?? '')) {
      const current = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : '';
      const blockId = current && !seen.has(current) ? current : crypto.randomUUID();
      seen.add(blockId);
      attrs = {...node.attrs, blockId};
    }
    return {...node, attrs, content: node.content?.map(visit)};
  };
  return visit(doc);
}

export function documentBlocks(doc: JSONContent): Array<{blockId: string; text: string}> {
  const result: Array<{blockId: string; text: string}> = [];
  const text = (node: JSONContent): string => node.text ?? node.content?.map(text).join('') ?? '';
  const visit = (node: JSONContent) => {
    if (blocks.has(node.type ?? '') && node.attrs?.blockId) result.push({blockId: String(node.attrs.blockId), text: text(node)});
    else node.content?.forEach(visit);
  };
  visit(doc);
  return result;
}

export function documentToText(doc: JSONContent): string {
  const walk = (node: JSONContent): string => node.text ?? (node.content?.map(walk).join(blocks.has(node.type ?? '') ? '' : '') ?? '');
  return (doc.content ?? []).map(walk).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function documentToMarkdown(doc: JSONContent): string {
  const render = (node: JSONContent): string => {
    const text = node.text ?? node.content?.map(render).join('') ?? '';
    switch (node.type) {
      case 'heading': return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${text}\n\n`;
      case 'paragraph': return `${text}\n\n`;
      case 'blockquote': return `> ${text}\n\n`;
      case 'bulletList': return (node.content?.map(child => `- ${render(child).trim()}\n`).join('') ?? '') + '\n';
      case 'orderedList': return (node.content?.map((child, index) => `${index + 1}. ${render(child).trim()}\n`).join('') ?? '') + '\n';
      case 'codeBlock': return `\`\`\`\n${text}\n\`\`\`\n\n`;
      case 'hardBreak': return '\n';
      default: return text;
    }
  };
  return render(doc).trim() + '\n';
}
