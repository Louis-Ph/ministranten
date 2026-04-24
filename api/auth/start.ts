'use strict';

const { config, configuredOAuthProviders, sendError, validateProvider } = require('../_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.statusCode = 405;
      return res.end('Method not allowed.');
    }
    const provider = String(req.query.provider || '');
    validateProvider(provider);
    if (!configuredOAuthProviders().includes(provider)) {
      res.statusCode = 403;
      return res.end('OAuth provider disabled.');
    }
    const cfg = config();
    const requestedRedirect = String(req.query.redirectTo || '');
    const redirectTo = safeRedirectTo(requestedRedirect, cfg.appBaseUrl);
    const state = String(req.query.state || '');
    if (state && !/^[a-f0-9]{32}$/.test(state)) {
      res.statusCode = 400;
      return res.end('Invalid OAuth state.');
    }
    // PKCE: RFC 7636 code_challenge (base64url of SHA-256(code_verifier)).
    // 43..128 chars, URL-safe alphabet. If absent we skip PKCE and Supabase
    // will use the implicit grant.
    const codeChallenge = String(req.query.code_challenge || '');
    if (codeChallenge && !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      res.statusCode = 400;
      return res.end('Invalid code_challenge.');
    }
    const authorizeUrl = new URL(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/authorize');
    authorizeUrl.searchParams.set('provider', provider);
    if (redirectTo) authorizeUrl.searchParams.set('redirect_to', redirectTo);
    if (state) authorizeUrl.searchParams.set('state', state);
    if (codeChallenge) {
      authorizeUrl.searchParams.set('code_challenge', codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('flow_type', 'pkce');
    }
    res.statusCode = 302;
    res.setHeader('Location', authorizeUrl.toString());
    return res.end();
  } catch (err) {
    return sendError(res, err);
  }
};

function safeRedirectTo(requested, appBaseUrl) {
  if (!requested) return appBaseUrl || '';
  if (!appBaseUrl) return requested;
  const base = new URL(appBaseUrl.startsWith('http') ? appBaseUrl : 'https://' + appBaseUrl);
  const candidate = new URL(requested);
  if (candidate.origin !== base.origin) return appBaseUrl;
  return candidate.toString();
}
