import { describe, expect, it } from 'vitest';
import { defaultModels, resolveModel } from './models';

describe('AI model resolution', () => {
  it('uses the concrete Codex model variant by default', () => {
    expect(defaultModels.codex_cli).toBe('gpt-5.6-terra');
  });

  it('migrates the unsupported short GPT-5.6 name', () => {
    expect(resolveModel('codex_cli', 'gpt-5.6')).toBe('gpt-5.6-terra');
    expect(resolveModel('openai', ' gpt-5.6 ')).toBe('gpt-5.6-terra');
  });

  it('preserves an explicitly selected concrete variant', () => {
    expect(resolveModel('codex_cli', 'gpt-5.6-sol')).toBe('gpt-5.6-sol');
  });
});
