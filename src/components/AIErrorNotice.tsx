import { errorDetails, type AppErrorCode } from '../lib/errors';

export function AIErrorNotice({code, compact = false, onDismiss}: {code: AppErrorCode; compact?: boolean; onDismiss?: () => void}) {
  const error = errorDetails(code);
  return <div className={`ai-error-notice${compact ? ' compact' : ''}`} role="alert">
    {onDismiss && <button className="ai-error-dismiss" type="button" onClick={onDismiss} aria-label="エラーを閉じる">×</button>}
    <strong>{error.title}</strong>
    <span>{error.message}</span>
    {error.action && <small>{error.action}</small>}
  </div>;
}
