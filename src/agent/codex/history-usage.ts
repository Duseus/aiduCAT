import { glob } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../core/logger';

export interface CodexLastUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Extracts the single-request `last_token_usage` from the newest Codex rollout session file.
 * Codex CLI stdout only outputs cumulative thread totals in `turn.completed`, which inflates
 * to 10M+ over a long conversation. The rollout log file on disk records the exact per-turn
 * physical context window fill (`last_token_usage`).
 */
export async function extractCodexLastUsage(codexHome: string): Promise<CodexLastUsage | undefined> {
  try {
    const pattern = join(codexHome, 'sessions', '**', '*.jsonl');
    const files: string[] = [];
    for await (const entry of glob(pattern)) {
      files.push(entry);
    }
    if (files.length === 0) return undefined;

    // Pick newest file by mtime
    let newestFile = files[0]!;
    let maxMtime = 0;
    for (const f of files) {
      try {
        const m = statSync(f).mtimeMs;
        if (m > maxMtime) {
          maxMtime = m;
          newestFile = f;
        }
      } catch {}
    }

    const content = readFileSync(newestFile, 'utf8');
    const lines = content.split('\n');
    let lastUsage: CodexLastUsage | undefined;

    for (const line of lines) {
      if (!line.includes('token_usage_record') && !line.includes('token_count')) continue;
      try {
        const d = JSON.parse(line);
        const t = d.type;
        const p = d.payload ?? {};
        if (t === 'token_usage_record' && p.usage && typeof p.usage.input_tokens === 'number') {
          lastUsage = {
            inputTokens: p.usage.input_tokens,
            outputTokens: p.usage.output_tokens ?? 0,
            cachedInputTokens: p.usage.cached_input_tokens,
          };
        } else if (t === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
          const l = p.info.last_token_usage;
          if (typeof l.input_tokens === 'number') {
            lastUsage = {
              inputTokens: l.input_tokens,
              outputTokens: l.output_tokens ?? 0,
              cachedInputTokens: l.cached_input_tokens,
            };
          }
        }
      } catch {}
    }

    return lastUsage;
  } catch (err) {
    log.warn('codex', 'extract-last-usage-failed', { err: String(err) });
    return undefined;
  }
}
