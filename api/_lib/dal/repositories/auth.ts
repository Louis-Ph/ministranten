/**
 * AuthRepository — wraps Supabase Auth REST.
 *
 * Domain ergonomics on top of the low-level `auth` client:
 *   - Verifies and returns a `SessionUser` (id + email).
 *   - Enforces the `APP_ALLOWED_EMAIL_DOMAINS` gate at one place.
 *   - Composes a **provisioning** flow used by `users.ts`: creates the Auth
 *     user, then calls `userOnCreate(uid)` to insert the app row, and
 *     compensates by deleting the Auth user if the app insert fails. This is
 *     as close as we can get to atomic across two systems (Auth + Postgres).
 */

import { getConfig } from '../config.js';
import {
  getSupabase,
  type AuthClient, type SupabaseUser, type SupabaseTokenResponse
} from '../supabase.js';
import { AppError, forbidden, unauthorized } from '../errors.js';
import { createLogger } from '../logger.js';

const log = createLogger('repo.auth');

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly appMetadata: Record<string, unknown>;
  readonly userMetadata: Record<string, unknown>;
}

export interface ProvisionInput {
  readonly email: string;
  readonly password: string;
  readonly userMetadata?: Record<string, unknown>;
}

export interface AuthRepository {
  /** Validates an access-token, enforces email-domain gate, returns the user. */
  resolveSession(accessToken: string): Promise<SessionUser>;
  /** Password sign-in. */
  signInWithPassword(email: string, password: string): Promise<SupabaseTokenResponse>;
  /** Refresh-token grant. */
  refresh(refreshToken: string): Promise<SupabaseTokenResponse>;
  /** PKCE code exchange. */
  exchangePkceCode(authCode: string, codeVerifier: string): Promise<SupabaseTokenResponse>;
  /**
   * Creates a Supabase Auth user, then calls `onCreated(uid)`. If `onCreated`
   * throws, the Auth user is hard-deleted as a compensating action and the
   * original error re-throws. This is how we keep Auth and `app_users` in sync
   * across two independent systems.
   */
  provisionWithApp(
    input: ProvisionInput,
    onCreated: (uid: string) => Promise<void>
  ): Promise<SupabaseUser>;
  /** Updates the password for the user identified by `userId`. Admin / self. */
  updatePassword(userId: string, newPassword: string): Promise<void>;
  /** List of OAuth providers actually enabled in Supabase right now. */
  listEnabledExternalProviders(): Promise<string[]>;
}

export function createAuthRepository(): AuthRepository {
  const sb: AuthClient = getSupabase().auth;

  return {
    async resolveSession(accessToken) {
      if (!accessToken) throw unauthorized();
      const user = await sb.getUserFromToken(accessToken);
      enforceEmailDomain(user.email);
      return {
        id: user.id,
        email: user.email || '',
        appMetadata: user.app_metadata || {},
        userMetadata: user.user_metadata || {}
      };
    },

    signInWithPassword(email, password) {
      return sb.signInWithPassword(email, password);
    },

    refresh(refreshToken) {
      return sb.refresh(refreshToken);
    },

    exchangePkceCode(authCode, codeVerifier) {
      return sb.exchangePkceCode(authCode, codeVerifier);
    },

    async provisionWithApp(input, onCreated) {
      const created = await sb.adminCreateUser({
        email: input.email,
        password: input.password,
        emailConfirm: true,
        userMetadata: input.userMetadata
      });
      try {
        await onCreated(created.id);
        return created;
      } catch (err) {
        log.warn('provisionWithApp.compensating', { uid: created.id, error: err });
        try {
          await sb.adminDeleteUser(created.id);
        } catch (delErr) {
          // Compensation failure is bad — log loudly so an operator can
          // clean up the orphan, and keep the original error on the wire.
          log.error('provisionWithApp.compensation_failed', { uid: created.id, error: delErr });
        }
        throw err;
      }
    },

    async updatePassword(userId, newPassword) {
      if (!newPassword || newPassword.length < 8) {
        throw new AppError(400, 'Mot de passe trop court.', 'invalid_input');
      }
      await sb.adminUpdateUser(userId, { password: newPassword });
    },

    async listEnabledExternalProviders() {
      const settings = await sb.getSettings();
      const external = settings.external || {};
      const out: string[] = [];
      for (const key in external) if (external[key] === true) out.push(key);
      return out;
    }
  };
}

function enforceEmailDomain(email: string | undefined): void {
  const cfg = getConfig();
  if (!cfg.allowedEmailDomains.length) return;
  const domain = String(email || '').split('@')[1] || '';
  if (!cfg.allowedEmailDomains.includes(domain.toLowerCase())) {
    throw forbidden('Domaine e-mail non autorise.', 'email_domain_denied');
  }
}
