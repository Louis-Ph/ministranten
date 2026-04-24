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
    const authorizeUrl = new URL(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/authorize');
    authorizeUrl.searchParams.set('provider', provider);
    if (redirectTo) authorizeUrl.searchParams.set('redirect_to', redirectTo);
    if (state) authorizeUrl.searchParams.set('state', state);
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
