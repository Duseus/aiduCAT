import { describe, expect, it } from 'vitest';
import { renderCard } from '../../../src/card/run-renderer.js';
import {
  initialState,
  parseClarifyMarker,
  reduce,
  markInterrupted,
} from '../../../src/card/run-state';

const MARKER =
  '[CLARIFY]{"question":"猫还是狗？","options":["猫","狗"]}';

describe('clarify marker parsing', () => {
  it('parses a well-formed marker', () => {
    const parsed = parseClarifyMarker(`我推荐两种方案。\n${MARKER}\n请选。`);
    expect(parsed).not.toBeNull();
    expect(parsed!.clarify.question).toBe('猫还是狗？');
    expect(parsed!.clarify.options).toEqual(['猫', '狗']);
    expect(parsed!.cleaned).toBe('我推荐两种方案。\n请选。');
  });

  it('returns null for malformed JSON (fail-open, text untouched)', () => {
    const text = '[CLARIFY]{"question":"bad"';
    expect(parseClarifyMarker(text)).toBeNull();
  });

  it('returns null when options are missing or empty', () => {
    expect(
      parseClarifyMarker('[CLARIFY]{"question":"q","options":[]}'),
    ).toBeNull();
    expect(
      parseClarifyMarker('[CLARIFY]{"question":"q"}'),
    ).toBeNull();
  });

  it('caps options at 8', () => {
    const opts = Array.from({ length: 12 }, (_, i) => `选项${i}`);
    const parsed = parseClarifyMarker(
      `[CLARIFY]${JSON.stringify({ question: 'q', options: opts })}`,
    );
    expect(parsed!.clarify.options).toHaveLength(8);
  });
});

describe('clarify in the reduce loop', () => {
  it('strips the marker from a streamed text block and stores the question', () => {
    let state = reduce(initialState, { type: 'text', delta: '方案如下\n[CLA' });
    // Delta splits the marker mid-way — nothing rendered from the sentinel on.
    state = reduce(state, { type: 'text', delta: 'RIFY]' });
    state = reduce(state, {
      type: 'text',
      delta: '{"question":"猫还是狗？","options":["猫","狗"]}',
    });
    state = reduce(state, { type: 'text', delta: '\n' });
    const text = state.blocks
      .filter((b) => b.kind === 'text')
      .map((b) => (b as { content: string }).content)
      .join('');
    expect(text).not.toContain('CLARIFY');
    expect(text).not.toContain('猫还是狗？');
    expect(state.clarify?.question).toBe('猫还是狗？');
    expect(state.clarify?.options).toEqual(['猫', '狗']);
  });

  it('interrupted runs keep the clarify for later render', () => {
    let state = reduce(initialState, { type: 'text', delta: `选一个\n${MARKER}` });
    state = markInterrupted(state);
    expect(state.clarify?.options).toEqual(['猫', '狗']);
  });
});

describe('clarify renders as dropdown form (f0.2 regression)', () => {
  it('final_text clarify renders a form with select + submit, no nested arrays', () => {
    let state = reduce(initialState, {
      type: 'final_text',
      content: '先问一下 [CLARIFY]{"question":"猫还是狗？","options":["猫","狗"]}',
    });
    state = reduce(state, { type: 'done', terminationReason: 'normal' });
    const card = renderCard(state) as { body: { elements: unknown[] } };
    const els = card.body.elements;
    for (const e of els) {
      expect(Array.isArray(e)).toBe(false);
    }
    const json = JSON.stringify(card);
    expect(json).toContain('select_static');
    expect(json).toContain('clarify_choice');
    expect(json).toContain('form_action_type');
    // options land in the dropdown
    expect(json).toContain('猫');
    expect(json).toContain('狗');
  });
});