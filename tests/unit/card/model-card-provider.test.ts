import { describe, expect, it } from 'vitest';
import { modelCard, parseModelCardSubmit } from '../../../src/card/model-card.js';
import { providerChoices, normalizeProvider } from '../../../src/bot/model-providers.js';

const providers = {
  '10r': {
    label: '10r 东京',
    baseUrl: 'https://gateway-b.example.com/v1',
    apiKey: '${AIDU_10R_TOKYO_KEY}',
    wire: 'anthropic' as const,
    contextWindow: 1_000_000,
  },
};

describe('/model provider dropdown (f0.2)', () => {
  it('renders provider select when extras configured', () => {
    const card = modelCard({
      combos: [{ id: '1', name: 'Gemini-3.8-Flash' }],
      providers: providerChoices(providers),
      currentProvider: 'default',
    } as never) as { body: { elements: unknown[] } };
    const json = JSON.stringify(card);
    expect(json).toContain('选择 provider');
    expect(json).toContain('10r 东京');
    expect(json).toContain('默认 · ');
  });

  it('hides provider select for single-provider deployments', () => {
    const card = modelCard({
      combos: [{ id: '1', name: 'M' }],
    }) as { body: { elements: unknown[] } };
    expect(JSON.stringify(card)).not.toContain('选择 provider');
  });

  it('parses provider submit and validates membership', () => {
    const parsed = parseModelCardSubmit(
      { combo: 'Gemini-3.8-Flash', effort: 'max', provider: '10r' },
      [{ name: 'Gemini-3.8-Flash' }],
      ['default', '10r'],
    );
    expect(parsed).toEqual({ provider: '10r', model: 'Gemini-3.8-Flash', effort: 'max' });
    const bad = parseModelCardSubmit(
      { combo: 'Gemini-3.8-Flash', effort: 'max', provider: 'rogue' },
      [{ name: 'Gemini-3.8-Flash' }],
      ['default', '10r'],
    );
    expect(bad.provider).toBeNull();
  });

  it('normalizeProvider unknown ids fall back to default', () => {
    expect(normalizeProvider(providers, '10r')).toBe('10r');
    expect(normalizeProvider(providers, 'ghost')).toBe('default');
    expect(normalizeProvider(providers, undefined)).toBe('default');
  });
});
