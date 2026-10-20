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
  /** aiduCAT: reasoning effort (low..max), shown on the panel header line 1. */
  effort?: string;
  /** aiduCAT: model context window (tokens) from 10router; enables the
   * context-usage percentage on header line 1. Undefined = no percentage. */
  contextWindow?: number;
}

export function renderCard(state: RunState, options: RunCardRenderOptions = {}): object {
  const elements: object[] = [];

  // aiduCAT: answer (text blocks or final_text) first, single aiduPOP panel below.
  const answerBlocks: string[] = [];
  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === 'text') {
      const trimmed = group.content.trim();
      if (trimmed) {
        // aiduCAT clarify: strip anything from a [CLARIFY] sentinel on — the
        // marker line (complete or half-streamed) never reaches the card.
        answerBlocks.push((group.content.split('[CLARIFY]')[0] ?? '').replace(/\n+$/, ''));
      }
    }
  }
  // Codex delivers the terminal response as `finalText` rather than stream text blocks.
  // Ensure it renders in the answer area above the panel so codex and claude have
  // the exact same unified single-card layout.
  if (state.finalText && state.finalText.trim()) {
    const stripped = (state.finalText.split('[CLARIFY]')[0] ?? '').replace(/\n+$/, '');
    if (!answerBlocks.some((b) => b.includes(stripped) || stripped.includes(b))) {
      answerBlocks.push(stripped);
    }
  }
  for (const text of answerBlocks) {
    if (text.trim()) {
      elements.push(markdown(text));
    }
  }

  // aiduCAT: live status word (🌊Waving… / 🫧Poping… / ☤aiduCATing…) sits on
  // its own line above the panel, below the answer, left-aligned — the panel
  // interior/header stays uniformly clean (猴哥点单 f0.1: panel 里始终保持美观整齐).
  // It disappears once the run ends — the panel border color carries the result.
  const statusLine =
    state.terminal === 'running'
      ? state.footer === 'tool_running'
        ? '🫧Poping…'
        : state.footer === 'streaming'
          ? '☤aiduCATing…'
          : '🌊Waving…'
      : '';
  if (statusLine) elements.push(markdown(statusLine));

  // aiduCAT: one collapsed panel carrying reasoning + every tool call + the
  // run meta header (aiduPOP layout). Hidden when there is nothing to show.
  const popPanel = aiduPopPanel(state, options);
  if (popPanel) elements.push(popPanel);

  // aiduCAT clarify: when the run ended while waiting on a parsed
  // [CLARIFY] marker, render the question + one button per option right
  // below the answer. A click forwards the choice back into the scope's
  // pending queue so the agent's session resumes with the answer.
  if (state.clarify && state.terminal !== 'running') {
    elements.push(markdown(`❓ **需要你确认**：${state.clarify.question}\n_点选下面按钮回复_`));
    elements.push(
      state.clarify.options.map((option) => ({
        tag: 'button',
        text: { tag: 'plain_text', content: option },
        type: 'default',
        size: 'medium',
        behaviors: [
          {
            type: 'callback',
            value: {
              cmd: 'clarify.answer',
              arg: JSON.stringify({ q: state.clarify!.question, a: option }),
            },
          },
        ],
      })),
    );
  }

  // aiduCAT: terminal state is expressed by the panel border color (aiduPOP
  // style) — 完成绿 / 停止黄 / 出错红 — not by a trailing text note. Keep an
  // empty-answer fallback note so a streamed card is never fully empty.
  if (state.terminal === 'done' && elements.length === 0) {
    elements.push(noteMd('🚫Nothing'));
  }

  // Hermes footer: 当任务结束时，在底部添加分割线和状态元数据行
  const footerElement = renderHermesFooter(state, options);
  if (footerElement) {
    elements.push({ tag: 'hr' });
    elements.push(footerElement);
  }

  // Mask raw emails across every text field so the Feishu tenant audit doesn't
  // reject the (streamed) card with a 400 EMAIL_ADDRESS — see mask-email.ts.
  const cardPayload: Record<string, any> = {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  };

  const hermesHeader = renderHermesHeader(state);
  if (hermesHeader) {
    cardPayload.header = hermesHeader;
  }

  return deepMaskEmails(cardPayload);
}

/**
 * Hermes 风格卡片 Header:
 * - streaming: 蓝色 template，标题显示 "💭 处理中..." 或 "💭 处理中... ⚡ <工具名>"
 * - done: 绿色 template，标题显示 "✅ 已完成"
 * - error: 红色 template，标题显示 "❌ 出错"
 * - interrupted / idle_timeout: 红色/黄色 template，标题显示 "⏹ 已停止"
 */
function renderHermesHeader(state: RunState): object | null {
  if (state.terminal === 'running') {
    let title = '💭 处理中...';
    const runningTool = state.blocks
      .filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool' && b.tool.status === 'running')
      .slice(-1)[0];
    if (runningTool) {
      const toolName = simplifyToolName(runningTool.tool.name);
      title = `💭 处理中... ⚡ ${toolName}`;
    }
    return {
      template: 'blue',
      title: { tag: 'plain_text', content: title },
    };
  }

  if (state.terminal === 'done') {
    return {
      template: 'green',
      title: { tag: 'plain_text', content: '✅ 已完成' },
    };
  }

  if (state.terminal === 'error') {
    return {
      template: 'red',
      title: { tag: 'plain_text', content: '❌ 出错' },
    };
  }

  if (state.terminal === 'interrupted' || state.terminal === 'idle_timeout') {
    return {
      template: 'red',
      title: { tag: 'plain_text', content: '⏹ 已停止' },
    };
  }

  return null;
}

/**
 * Hermes 风格底部 Footer:
 * 包含状态、上下文用量、模型:
 * "✅ 已完成 · 28.2k/1M (3%) · ⚕default"
 */
function renderHermesFooter(state: RunState, options: RunCardRenderOptions): object | null {
  if (state.terminal === 'running') return null;

  const parts: string[] = [];

  if (state.terminal === 'done') {
    parts.push('✅ 已完成');
  } else if (state.terminal === 'error') {
    parts.push('❌ 出错');
  } else if (state.terminal === 'interrupted' || state.terminal === 'idle_timeout') {
    parts.push('⏹ 已停止');
  }

  const ctx = contextUsageText(state, options);
  if (ctx) parts.push(ctx);

  if (options.model) {
    parts.push(`⚕${options.model}`);
  }
  if (options.effort) {
    parts.push(options.effort);
  }

  if (parts.length === 0) return null;

  const text = parts.join(' · ');
  const content = state.terminal === 'error' ? `<font color='red'>${text}</font>` : text;

  return {
    tag: 'markdown',
    content,
    text_size: 'notation',
  };
}

/** 把英文/内部工具名精简为大白话 */
function simplifyToolName(toolName: string): string {
  const mapping: Record<string, string> = {
    Bash: '跑命令',
    command_execution: '跑命令',
    Read: '读文件',
    Write: '写文件',
    Edit: '改文件',
    Grep: '搜内容',
    Glob: '搜文件',
    WebFetch: '看网页',
    WebSearch: '联网搜',
    Agent: '派任务',
    Task: '派任务',
  };
  return mapping[toolName] || toolName;
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
 * Hermes 风格 unified panel 标题:
 *   🧠  N 轮 · 🛠️  N 个工具 · ⏳  N.N 秒
 */
function metaHeader(state: RunState, options: RunCardRenderOptions): string {
  const parts: string[] = [];

  const rounds = Math.max(1, state.reasoning.segments);
  parts.push(`🧠  ${rounds} 轮`);

  const toolCount = state.blocks.filter((b) => b.kind === 'tool').length;
  parts.push(`🛠️  ${toolCount} 个工具`);

  let elapsedSec = 0.0;
  if (options.startedAt) {
    elapsedSec = Math.max(0, (Date.now() - options.startedAt) / 1000);
  }
  const elapsedStr =
    elapsedSec >= 60
      ? `${Math.floor(elapsedSec / 60)} 分 ${Math.floor(elapsedSec % 60)} 秒`
      : `${elapsedSec.toFixed(1)} 秒`;
  parts.push(`⏳  ${elapsedStr}`);

  if (state.terminal === 'error') parts.push('❌');

  return parts.join(' · ');
}

/**
 * aiduCAT: `***k/1M (xx%)` — how full the model's context window is right now.
 * Used tokens = prompt tokens (accounting for cached subsets) + output tokens.
 * Always scales against the real 1M context window deployed on 10router.
 */
function contextUsageText(state: RunState, options: RunCardRenderOptions): string {
  const u = state.usage;
  if (!u) return '';
  const inTokens = u.inputTokens ?? 0;
  const cachedTokens = u.cachedInputTokens ?? 0;
  // If inTokens >= cachedTokens, cached is already counted inside input_tokens (OpenAI/Codex standard).
  // Otherwise, cached tokens are complementary to prompt tokens (Anthropic standard).
  const effectiveInput = inTokens >= cachedTokens ? inTokens : inTokens + cachedTokens;
  const used = effectiveInput + (u.cacheCreationInputTokens ?? 0) + (u.outputTokens ?? 0);
  if (used === 0) return '';

  // 猴哥点单: 10router 上模型全量开放 1M (1,000,000) 上下文，分母基准统一保底 1M，彻底杜绝 '(累计)' 字样
  const windowSize = Math.max(options.contextWindow ?? 1_000_000, 1_000_000);
  const pct = Math.min(100, Math.round((used / windowSize) * 100));
  return `${formatTokens(used)}/${formatTokens(windowSize)} (${pct}%)`;
}

/** aiduCAT: 25046 -> `25k`, 1048576 -> `1M`, 500100 -> `500.1k`, 950 -> `950`. */
function formatTokens(n: number): string {
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}k`;
  return String(n);
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
    // aiduCAT: text_size=notation shrinks the collapsed header title to match
    // aiduPOP's small panel type (verified live: <font> tags are ignored on
    // panel headers, text_size on the title markdown is not).
    title: { tag: 'markdown', content: titleMd, text_size: 'notation' },
    vertical_align: 'center',
    icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', size: '16px 16px' },
    // 猴哥点单: pin the chevron to the far right of the header row instead of
    // hugging the title text (follow_text) — cleaner with the two-line header.
    icon_position: 'right',
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
