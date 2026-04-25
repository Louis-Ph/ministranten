/**
 * /api/auth/password — Email + password sign-in.
 *
 * Wraps `auth.signInWithPassword`. All upstream failures collapse to a
 * single user-facing message ("Anmeldung fehlgeschlagen", code
 * `invalid_login`) so we never leak whether an account exists.
 */

import { auth, errors } from '../_lib/dal/index.js';
import { withHandler } from '../_lib/dal/handler.js';

interface SignInBody {
  email?: string;
  password?: string;
}

export default withHandler<SignInBody, 'none'>({
  methods: ['POST'],
  auth: 'none',
  async handler({ body, send }) {
    const email = String(body.email || '');
    const password = String(body.password || '');
    if (!email || !password) {
      throw new errors.AppError(401, 'Anmeldung fehlgeschlagen.', 'invalid_login');
    }

    let tokens;
    try {
      tokens = await auth.signInWithPassword(email, password);
    } catch (_err) {
      throw new errors.AppError(401, 'Anmeldung fehlgeschlagen.', 'invalid_login');
    }

    send.json(200, {
      session: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        expires_at: tokens.expires_at,
        token_type: tokens.token_type
      },
      user: tokens.user
    });
  }
});
