import { errorDetails, type AppErrorCode } from '../lib/errors';

export function AIErrorNotice({code, compact = false}: {code: AppErrorCode; compact?: boolean}) {
  const error = errorDetails(code);
  return <div className={`ai-error-notice${compact ? ' compact' : ''}`} role="alert">
    <strong>{error.title}</strong>
    <span>{error.message}</span>
    {error.action && <small>{error.action}</small>}
  </div>;
}
