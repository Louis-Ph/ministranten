'use strict';

const {
  assertReadAllowed,
  assertWriteAllowed,
  getRootState,
  limitObjectTail,
  mergePlain,
  pathGet,
  pathSet,
  readBody,
  requireUser,
  roleFor,
  saveRootState,
  sendError,
  sendJson
} = require('./_lib/cloud');

module.exports = async function handler(req, res) {
  try {
    const user = await requireUser(req);
    const root = await getRootState();
    const role = roleFor(root, user.id);

    if (req.method === 'GET') {
      const path = req.query.path || '/';
      assertReadAllowed(path, user.id, role);
      const value = limitObjectTail(pathGet(root, path), req.query.limit);
      return sendJson(res, 200, { value: value == null ? null : value });
    }

    if (!['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    const body = await readBody(req);
    const path = body.path || req.query.path || '/';
    const current = pathGet(root, path);
    const value = req.method === 'DELETE'
      ? null
      : req.method === 'PATCH'
        ? mergePlain(current, body.value)
        : body.value;

    assertWriteAllowed(path, user.id, role, value);
    const nextRoot = pathSet(root, path, value);
    await saveRootState(nextRoot);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    return sendError(res, err);
  }
};
