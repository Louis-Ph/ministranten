'use strict';

const {
  getRootState,
  pathSet,
  readBody,
  requireUser,
  roleAtLeast,
  roleFor,
  saveRootState,
  sendError,
  sendJson,
  supabaseFetch
} = require('./_lib/cloud');

const MAIL_DOMAIN = '@minis-wettstetten.de';
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
const VALID_ROLES = new Set(['user', 'admin', 'dev']);

function publicProfileFromUser(profile) {
  return {
    username: profile.username,
    displayName: profile.displayName || profile.username
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method not allowed.' });
    }

    const caller = await requireUser(req);
    let root = await getRootState();
    const callerRole = roleFor(root, caller.id);
    if (!roleAtLeast(callerRole, 'dev')) {
      return sendJson(res, 403, { error: 'Creation utilisateur reservee au role dev.', code: 'forbidden' });
    }

    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const profile = body.profile || {};
    const role = VALID_ROLES.has(profile.role) ? profile.role : 'user';
    if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: 'Nom utilisateur invalide.', code: 'invalid_username' });
    if (password.length < 8) return sendJson(res, 400, { error: 'Mot de passe trop court.', code: 'weak_password' });

    const users = root.users || {};
    if ((Object.values(users) as any[]).some(user => user && user.username === username)) {
      return sendJson(res, 409, { error: 'Nom utilisateur deja utilise.', code: 'username_taken' });
    }

    const email = username + MAIL_DOMAIN;
    const created = await supabaseFetch('/auth/v1/admin/users', {
      method: 'POST',
      service: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username,
          display_name: profile.displayName || username
        }
      })
    });

    const uid = created.id;
    const privateProfile = {
      username,
      email,
      displayName: String(profile.displayName || username).slice(0, 60),
      role,
      mustChangePassword: profile.mustChangePassword === false ? false : true,
      createdAt: Date.now()
    };
    root = pathSet(root, '/users/' + uid, privateProfile);
    root = pathSet(root, '/publicProfiles/' + uid, publicProfileFromUser(privateProfile));
    await saveRootState(root);

    return sendJson(res, 201, { uid, username, email });
  } catch (err) {
    return sendError(res, err);
  }
};
