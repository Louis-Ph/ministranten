/**
 * /api/auth/callback — PKCE OAuth callback exchange.
 *
 * The client keeps the code_verifier in sessionStorage and posts
 * `{ code, code_verifier }` here when Supabase redirects back with `?code=…`.
 */

import { auth, errors } from '../_lib/dal/index.js';
import { withHandler } from '../_lib/dal/handler.js';

interface CallbackBody {
  code?: string;
  code_verifier?: string;
}

export default withHandler<CallbackBody, 'none'>({
  methods: ['POST'],
  auth: 'none',
  async handler({ body, send }) {
    const code = String(body.code || '');
    const codeVerifier = String(body.code_verifier || '');
    if (!code) throw errors.badRequest('Missing code.', 'invalid_input');
    if (!codeVerifier) throw errors.badRequest('Missing code_verifier.', 'invalid_input');
    // RFC 7636: 43..128 chars of [A-Z a-z 0-9 - . _ ~]
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) {
      throw errors.badRequest('Invalid code_verifier.', 'invalid_input');
    }

    let tokens;
    try {
      tokens = await auth.exchangePkceCode(code, codeVerifier);
    } catch (err) {
      // Surface the upstream message but normalize the code so the front
      // can switch on a single value.
      const msg = err instanceof Error ? err.message : 'OAuth exchange failed.';
      throw new errors.AppError(400, msg, 'pkce_exchange_failed');
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
