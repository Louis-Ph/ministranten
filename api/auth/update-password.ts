/**
 * /api/auth/update-password — Self-service password change.
 *
 * Authenticated users only. Sets a new password on the Supabase Auth
 * user identified by the bearer token's session.
 */

import { auth, errors } from '../_lib/dal/index.js';
import { withHandler } from '../_lib/dal/handler.js';

interface UpdatePasswordBody {
  password?: string;
}

export default withHandler<UpdatePasswordBody, 'required'>({
  methods: ['POST'],
  auth: 'required',
  async handler({ body, session, send }) {
    const password = String(body.password || '');
    if (password.length < 8) {
      throw new errors.AppError(400, 'Mot de passe trop court.', 'weak_password');
    }
    try {
      await auth.updatePassword(session.id, password);
    } catch (_err) {
      throw new errors.AppError(400, 'Mot de passe non mis a jour.', 'password_update_failed');
    }
    send.json(200, { ok: true });
  }
});
