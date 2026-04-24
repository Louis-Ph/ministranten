'use strict';

const { requireUser, sendError, sendJson } = require('../_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }
    const user = await requireUser(req);
    return sendJson(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        app_metadata: user.app_metadata || {},
        user_metadata: user.user_metadata || {}
      }
    });
  } catch (err) {
    return sendError(res, err);
  }
};
