/**
 * /api/health — Readiness probe.
 *
 * Used by ops dashboards and the front-end to verify the chain
 * Vercel → DAL → Supabase is wired correctly. Fast: hits a single
 * 1-row SELECT on `app_roles` to confirm the schema is in place.
 *
 * Response shape preserved from the legacy handler so existing tools
 * keep working.
 */

import { healthCheck } from './_lib/dal/index.js';
import { withHandler } from './_lib/dal/handler.js';

const ROOT_KEYS = ['chat', 'publicProfiles', 'services', 'stats', 'users'] as const;

export default withHandler<unknown, 'none'>({
  methods: ['GET'],
  auth: 'none',
  async handler({ send }) {
    const status = await healthCheck();
    if (!status.ok) {
      send.json(503, {
        ok: false,
        configured: status.configured,
        missing: status.missing,
        schema: 'not_checked'
      });
      return;
    }
    send.json(200, {
      ok: true,
      configured: true,
      schema: 'ready',
      root: 'ready',
      rootKeys: ROOT_KEYS.slice()
    });
  }
});
