'use strict';

const { config, readBody, requireUser, sendError, sendJson } = require('../_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const user = await requireUser(req);
    const body = await readBody(req);
    if (!body.password || String(body.password).length < 8) {
      return sendJson(res, 400, { error: 'Mot de passe trop court.', code: 'weak_password' });
    }
    const cfg = config();
    const response = await fetch(cfg.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/admin/users/' + encodeURIComponent(user.id), {
      method: 'PUT',
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: 'Bearer ' + cfg.serviceRoleKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: body.password })
    });
    if (!response.ok) return sendJson(res, 400, { error: 'Mot de passe non mis a jour.', code: 'password_update_failed' });
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendError(res, err);
  }
};
