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

describe('Hermes unified panel header', () => {
  it('carries 🧠 N 轮 · 🛠️ N 个工具 · ⏳ N.N 秒 in the panel header', () => {
    const state = stateWithUsage();
    const card = renderCard(state, {
      model: 'Gemini-3.8-Flash',
      effort: 'max',
      contextWindow: 1048576,
      startedAt: Date.now() - 5_000,
    });
    const title = panelTitle(card);
    expect(title).toBe('🧠  1 轮 · 🛠️  0 个工具 · ⏳  5.0 秒');
  });

  it('renders default zero elapsed when startedAt unset', () => {
    const state = stateWithUsage();
    const card = renderCard(state, { model: 'SomeModel' });
    const title = panelTitle(card);
    expect(title).toBe('🧠  1 轮 · 🛠️  0 个工具 · ⏳  0.0 秒');
  });

  it('renders elapsed in seconds when under a minute', () => {
    const card = renderCard(initialState, {
      model: 'GLM-5.3-Flash',
      effort: 'high',
      contextWindow: 1000000,
      startedAt: Date.now() - 1500,
    });
    expect(panelTitle(card)).toMatch(/⏳\s+1\.[456] 秒/);
  });

  it('zero thinking/tool counts still render in the line', () => {
    const card = renderCard(initialState, { model: 'M', startedAt: Date.now() - 1000 });
    const title = panelTitle(card);
    expect(title).toBe('🧠  1 轮 · 🛠️  0 个工具 · ⏳  1.0 秒');
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
    expect(title).toContain('🧠  1 轮');
    expect(title).toContain('🛠️  1 个工具');
    expect(title).toContain('⏳  2.0 秒');
  });

  it('renders Hermes footer with status, context, and model', () => {
    const state = reduce(stateWithUsage(), { type: 'done', terminationReason: 'normal' });
    const card = renderCard(state, {
      model: 'Gemini-3.8-Flash',
      contextWindow: 1048576,
    }) as any;

    const elements = card.body.elements;
    const footer = elements[elements.length - 1];
    expect(footer.tag).toBe('markdown');
    expect(footer.text_size).toBe('notation');
    expect(footer.content).toBe('✅ · 25k/1M (2%) · ⚕Gemini-3.8-Flash');
  });
});
