/**
 * /api/auth/start — Begin an OAuth login flow.
 *
 * Validates the provider and PKCE inputs, then redirects to Supabase's
 * `/auth/v1/authorize` endpoint with the right query string.
 */

import { errors, getConfig, type OauthProviderId } from '../_lib/dal/index.js';
import { withHandler } from '../_lib/dal/handler.js';

const VALID_PROVIDERS: ReadonlySet<OauthProviderId> = new Set(['google', 'github', 'azure', 'apple']);

export default withHandler<unknown, 'none'>({
  methods: ['GET'],
  auth: 'none',
  async handler({ req, send }) {
    const cfg = getConfig();
    const provider = readQuery(req.query?.provider) as OauthProviderId;
    if (!VALID_PROVIDERS.has(provider)) {
      throw errors.badRequest('Provider OAuth non supporte.', 'invalid_provider');
    }
    if (!cfg.oauthProviders.includes(provider)) {
      throw errors.forbidden('OAuth provider disabled.');
    }

    const state = readQuery(req.query?.state);
    if (state && !/^[a-f0-9]{32}$/.test(state)) {
      throw errors.badRequest('Invalid OAuth state.', 'invalid_input');
    }

    // PKCE: RFC 7636 code_challenge (base64url of SHA-256(code_verifier)).
    // 43..128 chars, URL-safe alphabet. If absent we skip PKCE and Supabase
    // will use the implicit grant.
    const codeChallenge = readQuery(req.query?.code_challenge);
    if (codeChallenge && !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      throw errors.badRequest('Invalid code_challenge.', 'invalid_input');
    }

    const requestedRedirect = readQuery(req.query?.redirectTo);
    const redirectTo = safeRedirectTo(requestedRedirect, cfg.appBaseUrl);

    const authorizeUrl = new URL(cfg.supabaseUrl + '/auth/v1/authorize');
    authorizeUrl.searchParams.set('provider', provider);
    if (redirectTo) authorizeUrl.searchParams.set('redirect_to', redirectTo);
    if (state) authorizeUrl.searchParams.set('state', state);
    if (codeChallenge) {
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('flow_type', 'pkce');
    }
    send.redirect(302, authorizeUrl.toString());
  }
});

function readQuery(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function safeRedirectTo(requested: string, appBaseUrl: string): string {
  if (!requested) return appBaseUrl || '';
  if (!appBaseUrl) return requested;
  try {
    const baseHref = appBaseUrl.startsWith('http') ? appBaseUrl : 'https://' + appBaseUrl;
    const base = new URL(baseHref);
    const candidate = new URL(requested);
    if (candidate.origin !== base.origin) return appBaseUrl;
    return candidate.toString();
  } catch {
    return appBaseUrl;
  }
}
