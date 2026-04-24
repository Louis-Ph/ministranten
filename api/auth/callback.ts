'use strict';

const { config, readBody, sendError, sendJson } = require('../_lib/cloud');

// Exchanges an OAuth authorization code (PKCE flow) for a Supabase session.
// The client keeps the code_verifier in sessionStorage and posts
// { code, code_verifier } here when Supabase redirects back with ?code=…
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const body = await readBody(req);
    const code = String(body && body.code || '');
    const codeVerifier = String(body && body.code_verifier || '');
    if (!code) return sendJson(res, 400, { error: 'Missing code.', code: 'missing_code' });
    if (!codeVerifier) return sendJson(res, 400, { error: 'Missing code_verifier.', code: 'missing_verifier' });
    // RFC 7636: 43..128 chars of [A-Z a-z 0-9 - . _ ~]
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) {
      return sendJson(res, 400, { error: 'Invalid code_verifier.', code: 'invalid_verifier' });
    }
    const cfg = config();
    const response = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      headers: {
        apikey: cfg.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const msg = data && (data.error_description || data.msg || data.error) || 'OAuth exchange failed.';
      const errorCode = data && (data.error_code || data.error) || 'pkce_exchange_failed';
      return sendJson(res, response.status, { error: msg, code: errorCode });
    }
    return sendJson(res, 200, {
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        expires_at: data.expires_at,
        token_type: data.token_type
      },
      user: data.user
    });
  } catch (err) {
    return sendError(res, err);
  }
};
