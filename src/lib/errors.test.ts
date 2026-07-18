import { describe,expect,it } from 'vitest'; import { errorMessage } from './errors';
describe('error normalization',()=>{it.each(['api_key_missing','invalid_api_key','quota_exceeded','network','timeout','unsupported_model','invalid_ai_output','sqlite','save_failed'] as const)('has a safe message for %s',code=>expect(errorMessage(code)).not.toContain('sk-'))});
