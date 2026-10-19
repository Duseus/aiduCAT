import { describe, expect, it } from 'vitest';
import { vendorLogoForModel } from '../../../src/card/model-logo.js';

describe('model → vendor logo mapping (f0.2)', () => {
  it('maps the models 猴哥 actually runs', () => {
    expect(vendorLogoForModel('Gemini-3.8-Flash')).toBe('gemini');
    expect(vendorLogoForModel('claude-opus-4-8')).toBe('claude');
    expect(vendorLogoForModel('claude-sonnet-5')).toBe('claude');
    expect(vendorLogoForModel('gpt-5-codex')).toBe('openai');
    expect(vendorLogoForModel('GLM-5.3-Flash')).toBe('zhipu');
    expect(vendorLogoForModel('kimi-k3')).toBe('kimi');
    expect(vendorLogoForModel('deepseek-v4')).toBe('deepseek');
    expect(vendorLogoForModel('qwen3-max')).toBe('qwen');
    expect(vendorLogoForModel('grok-5')).toBe('grok');
    expect(vendorLogoForModel('doubao-seed-2')).toBe('doubao');
  });

  it('falls back per family for upstream default aliases', () => {
    expect(vendorLogoForModel('opusplan')).toBe('claude');
    expect(vendorLogoForModel('o3')).toBe('openai');
    expect(vendorLogoForModel('gemma-3')).toBe('gemma');
    expect(vendorLogoForModel('moonshot-v2')).toBe('kimi');
  });

  it('returns undefined for unknown models (chevron fallback)', () => {
    expect(vendorLogoForModel('some-custom-combo')).toBeUndefined();
    expect(vendorLogoForModel(undefined)).toBeUndefined();
    expect(vendorLogoForModel('')).toBeUndefined();
  });
});
