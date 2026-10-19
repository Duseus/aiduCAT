import { describe, expect, it } from 'vitest';
import { renderCard } from '../../../src/card/run-renderer.js';
import { initialState, reduce, type RunState } from '../../../src/card/run-state.js';

/** Extract the collapsible_panel header title markdown from a rendered card. */
function panelTitle(card: object): string {
  const json = JSON.stringify(card);
  const m = json.match(/"title":\{"tag":"markdown","content":"((?:[^"\\]|\\.)*)"/);
  if (!m) throw new Error(`no panel title in card: ${json.slice(0, 200)}`);
  return JSON.parse(`"${m[1]}"`);
}

function stateWithUsage(overrides: Partial<RunState> = {}): RunState {
  let state = reduce(initialState, {
    type: 'usage',
    inputTokens: 4051,
    outputTokens: 532,
    cachedInputTokens: 20463,
    cacheCreationInputTokens: 0,
  });
  return { ...state, ...overrides };
}

describe('single-line panel header', () => {
  it('carries thinking · tools · elapsed · model · effort · ctx in a single line', () => {
    const state = stateWithUsage();
    const card = renderCard(state, {
      model: 'Gemini-3.8-Flash',
      effort: 'max',
      contextWindow: 1048576,
      startedAt: Date.now() - 5_000,
    });
    const title = panelTitle(card);
    expect(title).toBe('🌊 0 · 🫧 0 · ✨ 5s · Gemini-3.8-Flash · max · 25k/1M (2%)');
  });

  it('omits ctx% when contextWindow unknown, omits effort when unset', () => {
    const state = stateWithUsage();
    const card = renderCard(state, { model: 'SomeModel' });
    const title = panelTitle(card);
    expect(title).toBe('🌊 0 · 🫧 0 · SomeModel · 25k/1M (3%)');
  });

  it('omits the whole ctx piece until usage arrives', () => {
    const card = renderCard(initialState, {
      model: 'GLM-5.3-Flash',
      effort: 'high',
      contextWindow: 1000000,
    });
    expect(panelTitle(card)).toBe('🌊 0 · 🫧 0 · GLM-5.3-Flash · high');
  });

  it('formats used/total with k/M units and percentage', () => {
    let state = reduce(initialState, {
      type: 'usage',
      inputTokens: 100_000,
      outputTokens: 100,
      cachedInputTokens: 400_000,
      cacheCreationInputTokens: 0,
    });
    const card = renderCard(state, { model: 'M', contextWindow: 1_000_000 });
    expect(panelTitle(card)).toContain('500.1k/1M (50%)');
  });

  it('formats accumulated usage without claiming an impossible 100% window fill', () => {
    let state = reduce(initialState, {
      type: 'usage',
      inputTokens: 900_000,
      outputTokens: 200_000,
    });
    const card = renderCard(state, { model: 'M', contextWindow: 1_000_000 });
    expect(panelTitle(card)).toContain('1.1M/1M (100%)');
  });

  it('ignores the cumulative result-event usage (would show inflated 100%)', () => {
    let state = reduce(initialState, {
      type: 'usage',
      inputTokens: 25_000,
      outputTokens: 500,
      cachedInputTokens: 0,
    });
    // Terminal result carries the whole-turn cumulative total — must not
    // overwrite the per-message snapshot used for the readout.
    state = reduce(state, {
      type: 'usage',
      inputTokens: 900_000,
      outputTokens: 200_000,
      cumulative: true,
    });
    const card = renderCard(state, { model: 'M', contextWindow: 1_000_000 });
    expect(panelTitle(card)).toContain('25.5k/1M (3%)');
  });

  it('zero thinking/tool counts still render in the line', () => {
    const card = renderCard(initialState, { model: 'M', startedAt: Date.now() - 1000 });
    const title = panelTitle(card);
    expect(title).toBe('🌊 0 · 🫧 0 · ✨ 1s · M');
  });

  it('thinking and tool counts land in the line', () => {
    let state = reduce(initialState, { type: 'thinking', delta: 'hmm' });
    state = reduce(state, { type: 'tool_use', id: 't1', name: 'Bash', input: {} });
    const card = renderCard(state, {
      model: 'M',
      effort: 'low',
      contextWindow: 1000000,
      startedAt: Date.now() - 2000,
    });
    const title = panelTitle(card);
    expect(title).toContain('🌊 1');
    expect(title).toContain('🫧 1');
    expect(title).toContain('✨');
  });
});
