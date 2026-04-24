'use strict';

const { getRootState, isConfigured, sendError, sendJson } = require('./_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    if (!isConfigured()) return sendJson(res, 503, { ok: false, configured: false });
    await getRootState();
    return sendJson(res, 200, { ok: true, configured: true });
  } catch (err) {
    return sendError(res, err);
  }
};
