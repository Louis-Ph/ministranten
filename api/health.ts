/**
 * /api/health — Readiness probe.
 *
 * Used by ops dashboards and the front-end to verify the chain
 * Vercel → DAL → Supabase is wired correctly. Uses bounded table reads,
 * the read-only RPC catalog and Auth settings; it never writes app data.
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
        schema: status.configured ? 'not_ready' : 'not_checked',
        code: status.code
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
