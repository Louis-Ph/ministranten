/**
 * /api/auth/refresh — Exchange a refresh-token for a fresh access-token.
 *
 * All upstream failures collapse to `Session expiree.` / `refresh_failed`
 * so the front-end can clear the session and prompt re-login uniformly.
 */

import { auth, errors } from '../_lib/dal/index.js';
import { withHandler } from '../_lib/dal/handler.js';

interface RefreshBody {
  refresh_token?: string;
}

export default withHandler<RefreshBody, 'none'>({
  methods: ['POST'],
  auth: 'none',
  async handler({ body, send }) {
    const refreshToken = String(body.refresh_token || '');
    if (!refreshToken) {
      throw new errors.AppError(401, 'Session expiree.', 'refresh_failed');
    }

    let tokens;
    try {
      tokens = await auth.refresh(refreshToken);
    } catch (_err) {
      throw new errors.AppError(401, 'Session expiree.', 'refresh_failed');
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
