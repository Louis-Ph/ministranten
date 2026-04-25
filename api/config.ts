/**
 * /api/config — Public configuration probe.
 *
 * Returns the OAuth providers requested via env, intersected with what
 * Supabase Auth actually has enabled, plus a few flags used by the
 * front-end to render the login page. Response shape preserved from
 * the legacy handler.
 */

import { auth, getConfig, isConfigured, missingConfigKeys } from './_lib/dal/index.js';
import { withHandler } from './_lib/dal/handler.js';

// Supabase /auth/v1/settings returns providers under several aliases. We
// canonicalize them to our internal ids so the UI doesn't have to know.
const SUPABASE_PROVIDER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  google: ['google'],
  github: ['github'],
  azure: ['azure', 'azuread', 'azure_ad'],
  apple: ['apple']
};

function canonicalize(rawEnabled: readonly string[]): string[] {
  const enabledSet = new Set(rawEnabled);
  const out: string[] = [];
  for (const id in SUPABASE_PROVIDER_ALIASES) {
    if (SUPABASE_PROVIDER_ALIASES[id].some(alias => enabledSet.has(alias))) {
      out.push(id);
    }
  }
  return out;
}

export default withHandler<unknown, 'none'>({
  methods: ['GET'],
  auth: 'none',
  async handler({ send }) {
    const cfg = getConfig();
    const requested = cfg.oauthProviders.slice() as string[];
    const allowedEmailDomains = cfg.allowedEmailDomains.join(',');

    let supabaseReachable = false;
    let enabled: string[] = [];
    try {
      enabled = canonicalize(await auth.listEnabledExternalProviders());
      supabaseReachable = true;
    } catch (_err) {
      // Supabase unreachable from the lambda — degrade silently to the
      // requested list (the front shows nothing different to the user).
    }

    const effective = supabaseReachable
      ? requested.filter(p => enabled.includes(p))
      : requested.slice();
    const disabledInSupabase = supabaseReachable
      ? requested.filter(p => !enabled.includes(p))
      : [];

    send.json(200, {
      configured: isConfigured(),
      missing: missingConfigKeys(),
      auth: {
        providers: effective,
        requested,
        disabledInSupabase,
        allowedEmailDomains,
        supabaseReachable
      }
    });
  }
});
