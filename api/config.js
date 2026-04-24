'use strict';

const { config, configuredOAuthProviders, isConfigured, sendError, sendJson } = require('./_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const cfg = config();
    return sendJson(res, 200, {
      configured: isConfigured(),
      auth: {
        providers: configuredOAuthProviders(),
        allowedEmailDomains: cfg.allowedEmailDomains || ''
      }
    });
  } catch (err) {
    return sendError(res, err);
  }
};
