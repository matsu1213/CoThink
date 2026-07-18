import type { AIProviderKind } from '../types';

export const defaultModels: Record<AIProviderKind, string> = {
  mock: 'mock-v1',
  openai: 'gpt-5.6-terra',
  codex_cli: 'gpt-5.6-terra',
  claude_cli: 'sonnet',
};

export function resolveModel(provider: AIProviderKind, model: string | undefined) {
  const candidate = model?.trim();
  if (!candidate) return defaultModels[provider];
  if ((provider === 'openai' || provider === 'codex_cli') && candidate === 'gpt-5.6') return 'gpt-5.6-terra';
  return candidate;
}
