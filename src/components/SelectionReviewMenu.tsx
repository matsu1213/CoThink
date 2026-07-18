import type { ReviewMode, TextSelection } from '../types';

const actions: {mode: ReviewMode; label: string}[] = [
  {mode: 'concretize', label: '具体化'},
  {mode: 'assumptions', label: '前提'},
  {mode: 'counterpoint', label: '反論'},
  {mode: 'essence', label: '本質'},
  {mode: 'polish', label: '推敲'},
];

export function SelectionReviewMenu({selection, busy, onReview}: {
  selection: TextSelection;
  busy: boolean;
  onReview(mode: ReviewMode): void;
}) {
  const left = Math.max(190, Math.min(window.innerWidth - 190, selection.left));
  return <div className="selection-review" style={{top: selection.top, left}} role="toolbar" aria-label="選択範囲をAIレビュー">
    <div className="selection-actions">
      {actions.map(action => <button key={action.mode} disabled={busy} onMouseDown={event => { event.preventDefault(); onReview(action.mode); }}>{action.label}</button>)}
    </div>
  </div>;
}
