import { describe, expect, it } from 'vitest';
import { appErrorCodes, errorCode, errorDetails, errorMessage } from './errors';

describe('error normalization', () => {
  it.each(appErrorCodes)('has a safe and useful message for %s', code => {
    expect(errorMessage(code)).not.toContain('sk-');
    expect(errorDetails(code).title.length).toBeGreaterThan(0);
    expect(errorDetails(code).message.length).toBeGreaterThan(0);
  });
  it('accepts known backend codes', () => expect(errorCode({code: 'unsupported_model'})).toBe('unsupported_model'));
  it('does not expose an unknown backend code', () => expect(errorCode({code: 'secret backend detail'})).toBe('unknown'));
});
