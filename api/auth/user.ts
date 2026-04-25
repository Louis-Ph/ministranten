/**
 * /api/auth/user — Returns the current session's user.
 *
 * `withHandler` already validates the bearer token via `auth.resolveSession`
 * and enforces the email-domain gate before this handler runs.
 */

import { withHandler } from '../_lib/dal/handler.js';

export default withHandler<unknown, 'required'>({
  methods: ['GET'],
  auth: 'required',
  async handler({ session, send }) {
    send.json(200, {
      user: {
        id: session.id,
        email: session.email,
        app_metadata: session.appMetadata,
        user_metadata: session.userMetadata
      }
    });
  }
});
