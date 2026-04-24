'use strict';

const { configurationStatus, sendError, sendJson } = require('./_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const status = configurationStatus();
    return sendJson(res, 200, {
      configured: status.configured,
      missing: status.missing,
      auth: status.auth
    });
  } catch (err) {
    return sendError(res, err);
  }
};
