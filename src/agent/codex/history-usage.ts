import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../core/logger';

export interface CodexLastUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Fast, non-blocking tail read of the newest session rollout file.
 * Only reads the last 16KB of the file to extract `last_token_usage`.
 * Never reads the whole file into memory.
 */
export async function extractCodexLastUsage(codexHome: string): Promise<CodexLastUsage | undefined> {
  try {
    const sessionsRoot = join(codexHome, 'sessions');
    // Fast path: find today's directory YYYY/MM/DD
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const todayDir = join(sessionsRoot, yyyy, mm, dd);

    let targetDir = todayDir;
    let files: string[] = [];
    try {
      files = readdirSync(todayDir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      // Fallback: search sessionsRoot if today's dir does not exist
      return undefined;
    }
    if (files.length === 0) return undefined;

    // Pick newest file in today's directory by mtime
    let newestFile = join(todayDir, files[0]!);
    let maxMtime = 0;
    for (const f of files) {
      try {
        const full = join(todayDir, f);
        const m = statSync(full).mtimeMs;
        if (m > maxMtime) {
          maxMtime = m;
          newestFile = full;
        }
      } catch {}
    }

    // Read only the last 16KB of the file
    const stats = statSync(newestFile);
    const fd = openSync(newestFile, 'r');
    const bufferSize = Math.min(stats.size, 16384);
    const buffer = Buffer.alloc(bufferSize);
    const position = Math.max(0, stats.size - bufferSize);

    readSync(fd, buffer, 0, bufferSize, position);
    closeSync(fd);

    const chunk = buffer.toString('utf8');
    const lines = chunk.split('\n');
    let lastUsage: CodexLastUsage | undefined;

    // Scan backwards from the tail for the latest usage record
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
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
          break;
        } else if (t === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
          const l = p.info.last_token_usage;
          if (typeof l.input_tokens === 'number') {
            lastUsage = {
              inputTokens: l.input_tokens,
              outputTokens: l.output_tokens ?? 0,
              cachedInputTokens: l.cached_input_tokens,
            };
            break;
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
