import { log } from '../core/logger';
import { resolveAppSecret } from '../config/secret-resolver';
import type { AppConfig, SecretInput } from '../config/schema';

/**
 * aiduCAT: client for the 10router combo catalog (GET /api/combos).
 *
 * 猴哥's principle: only *custom combos* (the short curated list he manages
 * in the 10router dashboard) are offered in the /model card — never the
 * ~670 raw provider models behind /v1/models. Pulling live on every card
 * open means combos added/removed on 10router sync automatically.
 *
 * The management token is never hardcoded: it resolves through the secret
 * chain (env `AIDU_10ROUTER_TOKEN` → file → exec) via SecretInput, with a
 * plain config string as the last fallback for self-hosters who don't care.
 */

const COMBOS_TIMEOUT_MS = 8_000;
// aiduCAT: /v1/models is a fat payload (~200KB, 500+ entries) behind a
// Cloudflare tunnel — 3s+ is normal and tunnel jitter can double it. Give it
// its own generous budget so one slow fetch doesn't blank the ctx% readout.
const MODELS_TIMEOUT_MS = 20_000;

export interface TenRouterCombo {
  id: string;
  name: string;
  models: string[];
}

export interface TenRouterConfig {
  /** 10router base URL, e.g. https://10r.hycoforce.com */
  baseUrl: string;
  /** Management token value (x-10r-cli-token). */
  token: string;
}

export interface ComboCatalog {
  combos: TenRouterCombo[];
  /** 'live' = fetched now; 'cached' = recent fetch reused; 'unavailable' = fell back to stored preference only. */
  source: 'live' | 'cached' | 'unavailable';
}

interface CacheEntry {
  combos: TenRouterCombo[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: CacheEntry | undefined;

/** Read an env-style secret value via the app secret chain. A plain string
 * token rides the same "${VAR}" template resolution; SecretRef forms
 * (env/file/exec) go through the full provider chain rooted at cfg. */
async function resolveSecretValue(
  input: SecretInput,
  cfg: AppConfig,
): Promise<string> {
  // resolveAppSecret reads cfg.accounts.app.secret; we only need its
  // resolveSecretInput internals, so shim a minimal AppConfig carrying the
  // token as the "secret". Providers/allowlist config is shared.
  return resolveAppSecret({
    ...cfg,
    accounts: { app: { ...cfg.accounts.app, secret: input } },
  });
}

/**
 * Resolve 10router access from (in order):
 *  1. process.env.AIDU_10ROUTER_URL + AIDU_10ROUTER_TOKEN
 *  2. config `tenRouter.url` + `tenRouter.token` — the token rides the same
 *     SecretInput chain as the app secret (plain string / "${VAR}" template /
 *     env / file / exec), so it never has to sit in config plaintext.
 *  3. undefined (caller degrades to the direct-text /model flow)
 */
export async function resolveTenRouterConfig(
  cfg: AppConfig,
): Promise<TenRouterConfig | undefined> {
  const tenRouter = cfg.tenRouter;
  const url = (process.env.AIDU_10ROUTER_URL ?? tenRouter?.url ?? '').trim();
  if (!url) return undefined;
  let token: string | undefined;
  const envToken = process.env.AIDU_10ROUTER_TOKEN;
  if (envToken && envToken.trim() !== '') {
    token = envToken.trim();
  } else if (tenRouter?.token) {
    // Best-effort: a broken secret ref degrades the card to unavailable
    // instead of crashing the command.
    try {
      token = await resolveSecretValue(tenRouter.token, cfg);
    } catch (err) {
      log.warn('tenrouter', 'token-resolve-failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
  if (!token) return undefined;
  return { baseUrl: url.replace(/\/+$/, ''), token };
}

/** Fetch the custom combo list. 5-minute cache so re-opening the card soon after doesn't re-hit 10router. */
export async function fetchCombos(cfg: TenRouterConfig): Promise<ComboCatalog> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { combos: cache.combos, source: 'cached' };
  }
  try {
    const res = await fetch(`${cfg.baseUrl}/api/combos`, {
      headers: { 'x-10r-cli-token': cfg.token },
      signal: AbortSignal.timeout(COMBOS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { combos?: Array<{ id: string; name: string; models?: string[] }> };
    const combos = (body.combos ?? [])
      .map((c) => ({ id: String(c.id), name: String(c.name), models: (c.models ?? []).map(String) }))
      .filter((c) => c.id && c.name);
    if (combos.length === 0) throw new Error('empty combo list');
    cache = { combos, fetchedAt: Date.now() };
    log.info('tenrouter', 'combos-fetched', { count: combos.length });
    return { combos, source: 'live' };
  } catch (err) {
    log.warn('tenrouter', 'combos-fetch-failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { combos: [], source: 'unavailable' };
  }
}

/** Invalidate the cache (e.g. after a preference write, so the next open refetches). */
export function invalidateComboCache(): void {
  cache = undefined;
}

/**
 * aiduCAT: model name -> context window size, from 10router's /v1/models
 * (each combo entry carries `capabilities.contextWindow`). Used to render the
 * context-usage percentage in the run panel header. Fetched with the runtime
 * API key (ANTHROPIC_API_KEY), cached 10 min; failures yield an empty map so
 * the panel simply omits the percentage.
 */
const MODELS_TTL_MS = 10 * 60_000;
let contextWindows: { map: Map<string, number>; fetchedAt: number } | undefined;

export async function fetchContextWindows(baseUrl: string): Promise<Map<string, number>> {
  if (contextWindows && Date.now() - contextWindows.fetchedAt < MODELS_TTL_MS) {
    return contextWindows.map;
  }
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!apiKey) return contextWindows?.map ?? new Map();
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{ id?: string; capabilities?: { contextWindow?: number } }>;
    };
    const map = new Map<string, number>();
    for (const m of body.data ?? []) {
      const cw = m.capabilities?.contextWindow;
      if (m.id && typeof cw === 'number' && cw > 0) map.set(m.id, cw);
    }
    if (map.size > 0) contextWindows = { map, fetchedAt: Date.now() };
    return map;
  } catch (err) {
    log.warn('tenrouter', 'models-fetch-failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return contextWindows?.map ?? new Map();
  }
}
