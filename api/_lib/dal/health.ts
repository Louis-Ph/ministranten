import { missingConfigKeys } from './config.js';
import { AppError, isAppError, type ErrorCode } from './errors.js';
import { HEALTH_CONTRACT } from './health-contract.js';
import { createLogger } from './logger.js';
import { getSupabase } from './supabase.js';

const log = createLogger('dal.health');

export interface HealthStatus {
  ok: boolean;
  configured: boolean;
  missing: string[];
  code?: ErrorCode;
}

/** Read-only readiness: table columns/grants, seeded roles, RPC catalog, Auth. */
export async function healthCheck(): Promise<HealthStatus> {
  const missing = missingConfigKeys();
  if (missing.length) return { ok: false, configured: false, missing, code: 'cloud_not_configured' };

  const sb = getSupabase();
  const contract = HEALTH_CONTRACT.database;
  const checks = Object.entries(contract.tables).map(async ([table, columns]) => {
    const limit = table === 'app_roles' ? contract.roles.length : contract.rowLimit;
    const rows = await sb.rest.select<{ role_id?: string }>(table, 'select=' + columns.join(',') + '&limit=' + limit);
    if (table === 'app_roles' && contract.roles.some(role => !rows.some(row => row.role_id === role))) {
      throw new AppError(503, 'Roles applicatifs manquants.', 'schema_not_installed');
    }
  });
  checks.push(sb.rest.describe().then(spec => {
    if (contract.functions.some(name => !spec.paths['/rpc/' + name]?.post)) {
      throw new AppError(503, 'Migration DAL manquante ou inaccessible.', 'schema_not_installed');
    }
  }));
  checks.push(sb.auth.getSettings().then(() => undefined));

  const results = await Promise.allSettled(checks);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) {
    const code = isAppError(failure.reason) ? (failure.reason as AppError).code : 'internal_error';
    // No upstream response, credentials or user data belong in this public probe.
    log.warn('readiness.failed', { code });
    return { ok: false, configured: true, missing: [], code };
  }
  return { ok: true, configured: true, missing: [] };
}
