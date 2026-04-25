/**
 * DAL — Typed runtime configuration.
 *
 * Reads env once, caches it, exposes a single `getConfig()` to the rest of the
 * DAL. Throwing here would crash cold-starts; we instead return a partial
 * config and let `assertConfigured()` decide when missing values are fatal.
 */

export interface DalConfig {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly serviceRoleKey: string;
  readonly appBaseUrl: string;
  readonly allowedEmailDomains: readonly string[];
  readonly oauthProviders: readonly OauthProviderId[];
  /** Per-request HTTP timeout in ms for outbound Supabase calls. */
  readonly httpTimeoutMs: number;
  /** Number of retries on 5xx / network errors (excluding the first attempt). */
  readonly httpMaxRetries: number;
  /** Soft cap on concurrent outbound connections to Supabase. */
  readonly httpMaxConnections: number;
}

export type OauthProviderId = 'google' | 'github' | 'azure' | 'apple';

const VALID_PROVIDERS: ReadonlySet<OauthProviderId> = new Set(['google', 'github', 'azure', 'apple']);
const FREE_DEFAULT_PROVIDERS: readonly OauthProviderId[] = ['google', 'github', 'azure'];

let cached: DalConfig | null = null;

export function getConfig(): DalConfig {
  if (cached) return cached;
  cached = buildConfig();
  return cached;
}

/** Test-only — flush the cache so a new env can be picked up. */
export function resetConfigForTests(): void {
  cached = null;
}

function buildConfig(): DalConfig {
  return {
    supabaseUrl: trimSlashes(readEnv('SUPABASE_URL')),
    publishableKey: readEnv('SUPABASE_PUBLISHABLE_KEY', ['SUPABASE_ANON_KEY']),
    serviceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY'),
    appBaseUrl: readEnv('APP_BASE_URL', ['VERCEL_PROJECT_PRODUCTION_URL']),
    allowedEmailDomains: parseList(readEnv('APP_ALLOWED_EMAIL_DOMAINS')),
    oauthProviders: parseProviders(readEnv('APP_OAUTH_PROVIDERS')),
    httpTimeoutMs: parseInt(readEnv('DAL_HTTP_TIMEOUT_MS') || '8000', 10),
    httpMaxRetries: parseInt(readEnv('DAL_HTTP_MAX_RETRIES') || '1', 10),
    httpMaxConnections: parseInt(readEnv('DAL_HTTP_MAX_CONNECTIONS') || '32', 10)
  };
}

export function missingConfigKeys(cfg: DalConfig = getConfig()): string[] {
  const missing: string[] = [];
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.publishableKey) missing.push('SUPABASE_PUBLISHABLE_KEY');
  if (!cfg.serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return missing;
}

export function isConfigured(cfg: DalConfig = getConfig()): boolean {
  return missingConfigKeys(cfg).length === 0;
}

function readEnv(name: string, aliases: readonly string[] = []): string {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v) return v;
  }
  return '';
}

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function parseList(value: string): string[] {
  return value
    ? value.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
    : [];
}

function parseProviders(raw: string): OauthProviderId[] {
  const requested = raw
    ? raw.split(',').map(x => x.trim().toLowerCase())
    : (FREE_DEFAULT_PROVIDERS as string[]);
  const seen = new Set<string>();
  const out: OauthProviderId[] = [];
  for (const id of requested) {
    if (!VALID_PROVIDERS.has(id as OauthProviderId)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id as OauthProviderId);
  }
  return out;
}
