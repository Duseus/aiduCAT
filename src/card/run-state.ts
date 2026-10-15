import type { AgentEvent } from '../agent/types';

export type ToolStatus = 'running' | 'done' | 'error';

export interface ToolEntry {
  id: string;
  name: string;
  input: unknown;
  status: ToolStatus;
  output?: string;
}

export type Block =
  | { kind: 'text'; content: string; streaming: boolean }
  | { kind: 'tool'; tool: ToolEntry };

export type FooterStatus = 'thinking' | 'tool_running' | 'streaming' | null;
export type Terminal = 'running' | 'done' | 'interrupted' | 'error' | 'idle_timeout';

/** aiduCAT clarify: one parsed [CLARIFY]{...} marker emitted by the agent. */
export interface ClarifyQuestion {
  question: string;
  options: string[];
  /** Raw marker line, stripped from the visible text block. */
  raw: string;
}

export interface RunState {
  blocks: Block[];
  finalText?: string;
  reasoning: { content: string; active: boolean; segments: number };
  footer: FooterStatus;
  terminal: Terminal;
  errorMsg?: string;
  /** Set when terminal === 'idle_timeout' — how long claude was idle before
   * the watchdog gave up (so the message can say "N 分钟无响应"). */
  idleTimeoutMinutes?: number;
  /** aiduCAT clarify: last parsed question marker (rendered as option buttons
   * under the answer when the run ends waiting on user input). */
  clarify?: ClarifyQuestion;
}

export const initialState: RunState = {
  blocks: [],
  // segments: count of distinct thinking bursts (💭 in the aiduCAT panel).
  reasoning: { content: '', active: false, segments: 0 },
  footer: 'thinking',
  terminal: 'running',
};

/**
 * aiduCAT clarify marker: the bridge system prompt teaches the agent to emit
 * a single line `[CLARIFY]{"question":"...","options":["a","b"]}` when it
 * needs the user to pick. Parsed here so the renderer can turn it into
 * buttons and the text block stays clean. Tolerant of unescaped markers
 * split across stream deltas by re-scanning the accumulated text block.
 */
export function parseClarifyMarker(
  text: string,
): { clarify: ClarifyQuestion; cleaned: string } | null {
  const markerRegex = /\[CLARIFY\](\{[\s\S]*?\})(?:\n|$)/;
  const match = markerRegex.exec(text);
  if (!match) return null;
  const json = match[1] ?? '';
  try {
    const parsed = JSON.parse(json) as { question?: unknown; options?: unknown };
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    const options = Array.isArray(parsed.options)
      ? parsed.options.filter((o): o is string => typeof o === 'string' && o.trim() !== '')
      : [];
    // Not a well-formed clarify — leave the text alone (fail-open) rather
    // than swallow something the model emitted for a different purpose.
    if (!question || options.length === 0) return null;
    const start = match.index ?? 0;
    return {
      clarify: { question, options: options.slice(0, 8), raw: match[0] },
      cleaned:
        text.slice(0, start) + text.slice(start + match[0].length).replace(/^\n+/, ''),
    };
  } catch {
    return null;
  }
}

function closeStreamingText(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    b.kind === 'text' && b.streaming ? { ...b, streaming: false } : b,
  );
}

export function reduce(state: RunState, evt: AgentEvent): RunState {
  switch (evt.type) {
    case 'text': {
      const last = state.blocks[state.blocks.length - 1];
      const merged =
        last && last.kind === 'text' && last.streaming ? last.content + evt.delta : evt.delta;
      const parsed = parseClarifyMarker(merged);
      if (parsed) {
        const block: Block = { kind: 'text', content: parsed.cleaned, streaming: false };
        return {
          ...state,
          blocks:
            last && last.kind === 'text' && last.streaming
              ? [...state.blocks.slice(0, -1), block]
              : [...state.blocks, block],
          clarify: parsed.clarify,
          reasoning: { ...state.reasoning, active: false },
          footer: 'streaming',
        };
      }
      if (merged.includes('[CLARIFY]')) {
        // Marker started but not complete yet (stream deltas can split it
        // anywhere). Keep the full merged text in the block so the sentinel
        // survives into the next delta — the renderer strips everything from
        // the sentinel on, so users never see marker fragments.
        const block: Block = { kind: 'text', content: merged, streaming: true };
        return {
          ...state,
          blocks:
            last && last.kind === 'text' && last.streaming
              ? [...state.blocks.slice(0, -1), block]
              : [...state.blocks, block],
          reasoning: { ...state.reasoning, active: false },
          footer: 'streaming',
        };
      }
      const block: Block = { kind: 'text', content: merged, streaming: true };
      return {
        ...state,
        blocks:
          last && last.kind === 'text' && last.streaming
            ? [...state.blocks.slice(0, -1), block]
            : [...state.blocks, block],
        reasoning: { ...state.reasoning, active: false },
        footer: 'streaming',
      };
    }

    case 'final_text':
      return { ...state, finalText: evt.content };

    case 'thinking': {
      // A new thinking burst (previous burst was closed by text/tool) bumps
      // the segment counter shown as 💭 count in the aiduCAT meta panel.
      const startedNewSegment = !state.reasoning.active;
      return {
        ...state,
        reasoning: {
          content: state.reasoning.content + evt.delta,
          active: true,
          segments: state.reasoning.segments + (startedNewSegment ? 1 : 0),
        },
        footer: 'thinking',
      };
    }

    case 'tool_use': {
      const tool: ToolEntry = {
        id: evt.id,
        name: evt.name,
        input: evt.input,
        status: 'running',
      };
      return {
        ...state,
        blocks: [...closeStreamingText(state.blocks), { kind: 'tool', tool }],
        reasoning: { ...state.reasoning, active: false },
        footer: 'tool_running',
      };
    }

    case 'tool_result': {
      const blocks = state.blocks.map((b) => {
        if (b.kind !== 'tool' || b.tool.id !== evt.id) return b;
        return {
          ...b,
          tool: {
            ...b.tool,
            status: evt.isError ? ('error' as const) : ('done' as const),
            output: evt.output,
          },
        };
      });
      return { ...state, blocks };
    }

    case 'error': {
      const terminal =
        evt.terminationReason === 'interrupted'
          ? 'interrupted'
          : evt.terminationReason === 'timeout'
            ? 'idle_timeout'
            : 'error';
      return {
        ...state,
        terminal,
        errorMsg: terminal === 'error' ? evt.message : state.errorMsg,
        footer: null,
      };
    }

    case 'done': {
      const terminal =
        evt.terminationReason === 'interrupted'
          ? 'interrupted'
          : evt.terminationReason === 'timeout'
            ? 'idle_timeout'
            : 'done';
      return {
        ...state,
        blocks: closeStreamingText(state.blocks),
        reasoning: { ...state.reasoning, active: false },
        terminal,
        footer: null,
      };
    }

    default:
      return state;
  }
}

export function markInterrupted(state: RunState): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'interrupted',
    footer: null,
  };
}

export function markIdleTimeout(state: RunState, minutes: number): RunState {
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'idle_timeout',
    footer: null,
    idleTimeoutMinutes: minutes,
  };
}

export function finalizeIfRunning(state: RunState): RunState {
  if (state.terminal !== 'running') return state;
  return {
    ...state,
    blocks: closeStreamingText(state.blocks),
    reasoning: { ...state.reasoning, active: false },
    terminal: 'done',
    footer: null,
  };
}
