'use strict';

const { config, configurationStatus, sendError, sendJson } = require('./_lib/cloud');

// Maps our internal provider ids to the Supabase /auth/v1/settings `external` keys.
const SUPABASE_PROVIDER_ALIASES = {
  google: ['google'],
  github: ['github'],
  azure: ['azure', 'azuread', 'azure_ad'],
  apple: ['apple']
};

async function readSupabaseProviderState(cfg) {
  if (!cfg.supabaseUrl || !cfg.publishableKey) return { reachable: false, enabled: [] };
  try {
    const res = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/settings', {
      headers: { apikey: cfg.publishableKey }
    });
    if (!res.ok) return { reachable: false, enabled: [] };
    const data = await res.json().catch(() => null);
    const external = (data && data.external) || {};
    const enabled = [];
    for (const id in SUPABASE_PROVIDER_ALIASES) {
      if (SUPABASE_PROVIDER_ALIASES[id].some(alias => external[alias] === true)) enabled.push(id);
    }
    return { reachable: true, enabled };
  } catch (_) {
    return { reachable: false, enabled: [] };
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const status = configurationStatus();
    const cfg = config();
    const supabaseState = await readSupabaseProviderState(cfg);
    const requested = status.auth.providers || [];
    const effective = supabaseState.reachable
      ? requested.filter(p => supabaseState.enabled.includes(p))
      : requested.slice();
    const disabledInSupabase = supabaseState.reachable
      ? requested.filter(p => !supabaseState.enabled.includes(p))
      : [];
    return sendJson(res, 200, {
      configured: status.configured,
      missing: status.missing,
      auth: {
        providers: effective,
        requested,
        disabledInSupabase,
        allowedEmailDomains: status.auth.allowedEmailDomains || '',
        supabaseReachable: supabaseState.reachable
      }
    });
  } catch (err) {
    return sendError(res, err);
  }
};
