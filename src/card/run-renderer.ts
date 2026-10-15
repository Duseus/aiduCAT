import { deepMaskEmails } from './mask-email';
import type { Block, FooterStatus, RunState, ToolEntry } from './run-state';
import { toolBodyMd, toolHeaderPlain, toolHeaderText } from './tool-render';

const REASONING_MAX = 1500;
const COLLAPSE_TOOL_THRESHOLD = 3;

interface ToolGroup {
  kind: 'tools';
  tools: ToolEntry[];
}
interface TextGroup {
  kind: 'text';
  content: string;
}
type Group = ToolGroup | TextGroup;

export interface RunCardRenderOptions {
  signCallback?: (action: string) => string;
  /** aiduCAT: model name shown in the meta panel (e.g. Gemini-3.8-Flash). */
  model?: string;
  /** aiduCAT: epoch ms when the run started, for elapsed-time in meta panel. */
  startedAt?: number;
}

export function renderCard(state: RunState, options: RunCardRenderOptions = {}): object {
  const elements: object[] = [];

  // aiduCAT: answer (text blocks) first, single aiduPOP panel below.
  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === 'text') {
      if (group.content.trim()) {
        elements.push(markdown(group.content));
      }
    }
  }

  // aiduCAT: one collapsed panel carrying reasoning + every tool call + the
  // run meta header (aiduPOP layout). Hidden when there is nothing to show.
  const popPanel = aiduPopPanel(state, options);
  if (popPanel) elements.push(popPanel);

  // aiduCAT: terminal state is expressed by the panel border color (aiduPOP
  // style) — 完成绿 / 停止黄 / 出错红 — not by a trailing text note. Keep an
  // empty-answer fallback note so a streamed card is never fully empty.
  if (state.terminal === 'done' && elements.length === 0) {
    elements.push(noteMd('🚫Nothing'));
  }

  // aiduCAT: no footer status line and no stop button — the live status word
  // lives at the far left of the panel header while running and vanishes on
  // completion (border color takes over), and stopping goes through /stop.

  // Mask raw emails across every text field so the Feishu tenant audit doesn't
  // reject the (streamed) card with a 400 EMAIL_ADDRESS — see mask-email.ts.
  return deepMaskEmails({
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  });
}

/**
 * aiduCAT single panel (aiduPOP layout): the collapsed header carries only
 * `☤ model · 🌊 thinking-count · 🫧 tool-count · ✨ elapsed`, and the body
 * holds the thinking text plus one entry per tool call. Rendered below the
 * answer; omitted entirely for a run with no reasoning, tools, or meta.
 *
 * While running, the footer already carries the live status line, so the
 * collapsed header stays pure meta (counts + elapsed); on completion the
 * counts/values are final.
 */
function aiduPopPanel(state: RunState, options: RunCardRenderOptions): object | null {
  const tools = state.blocks.filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool');
  const hasReasoning = state.reasoning.content.trim().length > 0;
  const hasError = state.terminal === 'error' && !!state.errorMsg;

  const meta = metaHeader(state, options);
  if (!hasReasoning && tools.length === 0 && !meta) return null;

  const title = meta;

  const bodyParts: string[] = [];
  if (hasError) bodyParts.push(`⚠️ ${state.errorMsg}`);
  if (hasReasoning) {
    // aiduCAT: 🌊 marks a thinking burst — same emoji as the collapsed header.
    bodyParts.push(`🌊 ${truncate(state.reasoning.content, REASONING_MAX)}`);
  }
  if (tools.length > 0) {
    // Latest tool on top so the freshest activity is what you see on expand.
    // 猴哥点菜单：每个工具用自己的专属 emoji（👩🏻‍💻Bash 等），不再加统一的 🫧。
    const lines = tools
      .slice()
      .reverse()
      .map((b) => `- ${toolHeaderText(b.tool)}`);
    bodyParts.push(lines.join('\n'));
  }

  return collapsiblePanel({
    title,
    expanded: false,
    // aiduCAT: border color carries the terminal state (aiduPOP style) —
    // running/none grey, done green, stopped/timeout yellow, error red.
    border: panelBorderColor(state),
    body: bodyParts.join('\n\n') || '_（无过程记录）_',
  });
}

/** aiduCAT: 完成绿 / 停止黄 / 出错红 / 运行或无过程灰。 */
function panelBorderColor(state: RunState): 'grey' | 'green' | 'yellow' | 'red' {
  if (state.terminal === 'done') return 'green';
  if (state.terminal === 'interrupted' || state.terminal === 'idle_timeout') return 'yellow';
  if (state.terminal === 'error') return 'red';
  return 'grey';
}

/**
 * aiduPOP header fragment: `☤ model · 🌊 n · 🫧 n · ✨ elapsed`. Each piece
 * only appears when it has a value; separators are the aiduPOP `·`.
 * Elapsed keeps ticking across card updates because renderCard is re-run on
 * every streaming update with the fixed `options.startedAt`.
 */
function metaHeader(state: RunState, options: RunCardRenderOptions): string {
  const pieces: string[] = [];
  // aiduCAT: while running, the live status word (🌊Waving… / 🫧Poping… /
  // ☤aiduCATing…) leads the header at the far left; it disappears once the
  // run ends — the panel border color carries the result from there.
  if (state.terminal === 'running') {
    const status =
      state.footer === 'tool_running'
        ? '🫧Poping…'
        : state.footer === 'streaming'
          ? '☤aiduCATing…'
          : '🌊Waving…';
    pieces.push(status);
  }
  if (options.model) pieces.push(`☤ ${options.model}`);
  if (state.reasoning.segments > 0) pieces.push(`🌊 ${state.reasoning.segments}`);
  const toolCount = state.blocks.filter((b) => b.kind === 'tool').length;
  if (toolCount > 0) pieces.push(`🫧 ${toolCount}`);
  if (options.startedAt) {
    const secs = Math.max(0, Math.round((Date.now() - options.startedAt) / 1000));
    const label = secs >= 60 ? `${Math.floor(secs / 60)}m${secs % 60}s` : `${secs}s`;
    pieces.push(`✨ ${label}`);
  }
  if (state.terminal === 'error') pieces.push('❌');
  return pieces.join(' · ');
}

function* groupBlocks(blocks: Block[]): Generator<Group> {
  let toolBuf: ToolEntry[] = [];
  for (const b of blocks) {
    if (b.kind === 'tool') {
      toolBuf.push(b.tool);
    } else {
      if (toolBuf.length > 0) {
        yield { kind: 'tools', tools: toolBuf };
        toolBuf = [];
      }
      yield { kind: 'text', content: b.content };
    }
  }
  if (toolBuf.length > 0) yield { kind: 'tools', tools: toolBuf };
}

function toolPanel(tool: ToolEntry, expanded: boolean): object {
  return collapsiblePanel({
    title: toolHeaderText(tool),
    expanded,
    border: tool.status === 'error' ? 'red' : 'grey',
    body: toolBodyMd(tool) || '_无输出_',
  });
}

interface PanelOpts {
  title: string;
  expanded: boolean;
  border: 'grey' | 'red' | 'blue' | 'green' | 'yellow';
  body: string;
}

function collapsiblePanel(opts: PanelOpts): object {
  return {
    tag: 'collapsible_panel',
    expanded: opts.expanded,
    header: panelHeader(opts.title),
    border: { color: opts.border, corner_radius: '5px' },
    vertical_spacing: '8px',
    padding: '8px 8px 8px 8px',
    elements: [{ tag: 'markdown', content: opts.body, text_size: 'notation' }],
  };
}

function panelHeader(titleMd: string): object {
  return {
    title: { tag: 'markdown', content: titleMd },
    vertical_align: 'center',
    icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
    icon_position: 'follow_text',
    icon_expanded_angle: -180,
  };
}

function markdown(content: string): object {
  return { tag: 'markdown', content };
}

function noteMd(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' };
}

function summaryText(state: RunState): string {
  if (state.terminal === 'interrupted') return '⭕️';
  if (state.terminal === 'idle_timeout') return '⚠️';
  if (state.terminal === 'error') return '❌';
  if (state.terminal === 'done') return '✅';
  if (state.footer === 'tool_running') return '🫧Poping…';
  if (state.footer === 'streaming') return '☤aiduCATing…';
  return '🌊Waving…';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
