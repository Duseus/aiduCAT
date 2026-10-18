import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../../core/logger';

export interface CodexLastUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Fast, non-blocking tail read of this run's session rollout file.
 * `threadId` (from the thread.started event) pins the exact rollout
 * `rollout-*-<threadId>.jsonl` so concurrent group/p2p runs can never
 * steal each other's usage snapshot. Only the last 64KB of the file is
 * read — never the whole file. No threadId = legacy newest-file pick.
 */
export async function extractCodexLastUsage(
  codexHome: string,
  threadId?: string,
): Promise<CodexLastUsage | undefined> {
  try {
    const sessionsRoot = join(codexHome, 'sessions');
    // Scan the last 3 UTC days: Codex files a rollout under the date the
    // session STARTED, so after UTC midnight a still-live thread keeps
    // appending to yesterday's directory while "today" has no files at all.
    const dirs: string[] = [];
    for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
      const day = new Date(Date.now() - dayOffset * 86_400_000);
      const yyyy = String(day.getUTCFullYear());
      const mm = String(day.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(day.getUTCDate()).padStart(2, '0');
      dirs.push(join(sessionsRoot, yyyy, mm, dd));
    }

    let files: { name: string; dir: string }[] = [];
    for (const dir of dirs) {
      try {
        for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
          files.push({ name: f, dir });
        }
      } catch {
        // Missing day directory (early hours after UTC midnight) — keep going.
      }
    }
    // aiduCAT: pin this run's own rollout — with group+p2p running at once,
    // mtime picks whichever session flushed last and reads a stranger's tail.
    if (threadId) {
      files = files.filter((f) => f.name.includes(threadId));
    }
    if (files.length === 0) return undefined;

    // Pick newest file by mtime
    let newestFile = join(files[0]!.dir, files[0]!.name);
    let maxMtime = 0;
    for (const f of files) {
      try {
        const full = join(f.dir, f.name);
        const m = statSync(full).mtimeMs;
        if (m > maxMtime) {
          maxMtime = m;
          newestFile = full;
        }
      } catch {}
    }

    // Read only the last 64KB of the file (long tool outputs can push the
    // usage record out of a 16KB window)
    const stats = statSync(newestFile);
    const fd = openSync(newestFile, 'r');
    const bufferSize = Math.min(stats.size, 65536);
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
