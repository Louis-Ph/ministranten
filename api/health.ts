'use strict';

const { configurationStatus, getRootState, sendError, sendJson } = require('./_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const status = configurationStatus();
    if (!status.configured) {
      return sendJson(res, 503, {
        ok: false,
        configured: false,
        missing: status.missing,
        schema: 'not_checked'
      });
    }
    const root = await getRootState();
    return sendJson(res, 200, {
      ok: true,
      configured: true,
      schema: 'ready',
      root: 'ready',
      rootKeys: Object.keys(root || {}).sort()
    });
  } catch (err) {
    return sendError(res, err);
  }
};
