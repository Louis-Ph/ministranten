/**
 * /api/users — Provision a new app user (dev role only).
 *
 * Wraps Supabase Auth user creation and the corresponding `app_users`
 * insert into a single, compensating operation: if the app-side insert
 * throws, the just-created Auth user is hard-deleted so we never leave
 * an orphan that can sign in but has no app row.
 */

import { auth, db, errors, requireRole, types } from './_lib/dal/index.js';
import { withHandler } from './_lib/dal/handler.js';

const MAIL_DOMAIN = '@minis-wettstetten.de';

interface CreateUserBody {
  username?: string;
  password?: string;
  profile?: {
    displayName?: string;
    role?: types.RoleId;
    mustChangePassword?: boolean;
  };
}

export default withHandler<CreateUserBody, 'required'>({
  methods: ['POST'],
  auth: 'required',
  async handler({ body, session, send }) {
    const callerRole = await requireRole(db.users, session.id);
    if (!types.roleAtLeast(callerRole, 'dev')) {
      throw errors.forbidden('Creation utilisateur reservee au role dev.');
    }

    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const profile = body.profile || {};
    const targetRole: types.RoleId = types.isValidRole(profile.role) ? profile.role : 'user';

    if (!types.isValidUsername(username)) {
      throw errors.badRequest('Nom utilisateur invalide.', 'invalid_input');
    }
    if (password.length < 8) {
      throw errors.badRequest('Mot de passe trop court.', 'weak_password');
    }
    if (await db.users.usernameExists(username)) {
      throw errors.conflict('Nom utilisateur deja utilise.', 'username_taken');
    }

    const email = username + MAIL_DOMAIN;
    const displayName = String(profile.displayName || username).slice(0, 60);
    const mustChangePassword = profile.mustChangePassword === false ? false : true;

    // Atomic-ish across two systems: creates the Auth user, runs the
    // app-side insert, and on app-side failure deletes the Auth user
    // back out as a compensating action.
    const created = await auth.provisionWithApp(
      {
        email,
        password,
        userMetadata: { username, display_name: displayName }
      },
      async (uid: string) => {
        await db.users.insert(uid, {
          username,
          email,
          displayName,
          role: targetRole,
          mustChangePassword,
          createdAt: Date.now()
        });
      }
    );

    send.json(201, { uid: created.id, username, email });
  }
});
