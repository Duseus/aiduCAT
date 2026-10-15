/**
 * aiduCAT /model interactive card: combo dropdown + effort dropdown + submit.
 *
 * 猴哥点单 (f0.1): the submit button is only reachable once BOTH selects
 * have a value — implemented by disabling the submit until the form is
 * complete via Feishu's select "required" validation (a required empty
 * select blocks form submit with a native prompt), plus a client-side hint.
 */

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export interface ModelCardOpts {
  /** Combo names from 10router (live or cached). */
  combos: Array<{ id: string; name: string }>;
  /** Currently stored model preference (combo name), if any. */
  currentModel?: string;
  /** Currently stored effort, if any. */
  currentEffort?: string;
  /** Whether the 10router fetch succeeded — shapes the hint line. */
  source: 'live' | 'cached' | 'unavailable';
}

/** /model — the selection card. */
export function modelCard(opts: ModelCardOpts): object {
  const hint =
    opts.source === 'unavailable'
      ? '⚠️ 10router 暂时取不到 combo 列表（用下拉里的兜底项，或稍后重开）'
      : opts.source === 'cached'
        ? '_combo 列表来自 5 分钟内缓存_'
        : '_combo 列表实时来自 10router_';

  const comboValues =
    opts.combos.length > 0
      ? opts.combos.map((c) => ({ text: { tag: 'plain_text', content: c.name }, value: c.name }))
      // Feishu select_static rejects an empty options array — always give the
      // user something, and the unavailable hint above explains why.
      : [{ text: { tag: 'plain_text', content: '（取不到 combo 列表）' }, value: '__none__' }];

  const modelElements: object[] = [
    {
      tag: 'select_static',
      name: 'combo',
      placeholder: { tag: 'plain_text', content: '选择模型 combo' },
      ...(opts.currentModel && opts.combos.some((c) => c.name === opts.currentModel)
        ? { initial_option: opts.currentModel }
        : {}),
      options: comboValues,
    },
    { tag: 'hr' },
    {
      tag: 'markdown',
      content:
        '**推理强度 (effort)**\n' +
        '_low 最快最省, max 最深最慢; 对应 Claude Code `--effort`_',
    },
    {
      tag: 'select_static',
      name: 'effort',
      placeholder: { tag: 'plain_text', content: '选择推理强度' },
      ...(opts.currentEffort && (EFFORT_LEVELS as readonly string[]).includes(opts.currentEffort)
        ? { initial_option: opts.currentEffort }
        : {}),
      options: EFFORT_LEVELS.map((level) => ({
        text: { tag: 'plain_text', content: level },
        value: level,
      })),
    },
    { tag: 'hr' },
    {
      tag: 'markdown',
      // 猴哥's rule: both selects must be chosen before submit. Required
      // selects make Feishu block submit natively until they're filled.
      content: '⚠️ 模型与强度**都选好后**才能点确认;提交后,下一轮对话生效',
    },
    {
      tag: 'button',
      text: { tag: 'plain_text', content: '✅ 确认切换' },
      type: 'primary',
      form_action_type: 'submit',
      name: 'model_submit',
      behaviors: [{ type: 'callback', value: { cmd: 'model.submit' } }],
    },
  ];

  return {
    schema: '2.0',
    config: {},
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            `☤ **模型切换**\n\n${hint}\n\n` +
            `当前: ${opts.currentModel ? `\`${opts.currentModel}\`` : '跟随默认'}` +
            ` · effort: ${opts.currentEffort ?? '默认'}`,
        },
        { tag: 'hr' },
        {
          tag: 'form',
          name: 'model_form',
          elements: [
            {
              tag: 'markdown',
              content: '**模型 combo**\n_10router 自定义组合,增删在 10router 面板操作_',
            },
            ...modelElements,
          ],
        },
      ],
    },
  };
}

/** /model submit — result card shown in place after saving. */
export function modelSavedCard(model: string, effort: string): object {
  return {
    schema: '2.0',
    config: {},
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            `✅ 已保存：模型 \`${model}\` · effort \`${effort}\`\n\n_下一轮对话生效; 已在跑的任务不受影响_`,
        },
      ],
    },
  };
}

/** /model cancel — restores the previous card contents (no-op stub for now). */
export function modelCancelledCard(): object {
  return {
    schema: '2.0',
    config: {},
    body: {
      elements: [{ tag: 'markdown', content: '已取消,未做修改。' }],
    },
  };
}

/** Parse submitted form values into (model, effort); null = keep current. */
export function parseModelCardSubmit(
  formValue: Record<string, unknown>,
  combos: Array<{ name: string }>,
): { model: string | null; effort: string | null } {
  const rawModel = String(formValue.combo ?? '').trim();
  const validModel =
    rawModel !== '' && rawModel !== '__none__' && combos.some((c) => c.name === rawModel)
      ? rawModel
      : null;
  const rawEffort = String(formValue.effort ?? '').trim();
  const validEffort = (EFFORT_LEVELS as readonly string[]).includes(rawEffort) ? rawEffort : null;
  return { model: validModel, effort: validEffort };
}
