'use strict';

const { config, readBody, sendError, sendJson } = require('../_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const cfg = config();
    const body = await readBody(req);
    const response = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        apikey: cfg.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: body.email, password: body.password })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return sendJson(res, response.status, { error: 'Anmeldung fehlgeschlagen.', code: 'invalid_login' });
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
