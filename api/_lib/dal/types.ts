/**
 * DAL — Types.
 *
 * Two layers:
 *   - DB row types (`*Row`): exact shape of Postgres tables. snake_case.
 *     Use these only inside the DAL and inside RPC payloads.
 *   - Domain types (no suffix): shape used by handlers and the front-end.
 *     camelCase, ms-epoch numbers instead of ISO strings, no nullables when
 *     the domain has a default.
 *
 * Mappers between the two live in `mappers.ts`.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type RoleId = 'user' | 'admin' | 'dev';

export const ROLE_RANK: Readonly<Record<RoleId, number>> = Object.freeze({
  user: 1,
  admin: 2,
  dev: 3
});

export function roleAtLeast(role: RoleId, minRole: RoleId): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface UserRow {
  user_id: string;
  username: string;
  email: string;
  display_name: string;
  role_id: RoleId;
  must_change_password: boolean;
  created_at: string;
}

export interface PrivateUserProfile {
  username: string;
  email: string;
  displayName: string;
  role: RoleId;
  mustChangePassword: boolean;
  createdAt: number;
}

export interface PublicUserProfile {
  username: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Services & attendees
// ---------------------------------------------------------------------------

export interface ServiceRow {
  service_id: string;
  title: string;
  description: string;
  start_at: string;
  deadline_days: number;
  min_slots: number;
  color: string;
  replacement_needed: boolean;
  stats_applied: boolean;
  created_by: string | null;
  created_at: string;
}

export interface AttendeeRow {
  service_id: string;
  user_id: string;
  signed_up_at: string;
}

export interface Attendee {
  uid: string;
  username: string;
  displayName: string;
  ts: number;
}

export interface Service {
  title: string;
  description: string;
  startMs: number;
  deadlineDays: number;
  minSlots: number;
  color: string;
  replacement: boolean;
  statsApplied: boolean;
  createdBy: string | null;
  createdAt: number;
  /** Map keyed by user-id → attendee. */
  attendees: Record<string, Attendee>;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatsRow {
  user_id: string;
  attended: number;
  cancelled: number;
  late_cancelled: number;
}

export interface UserStats {
  attended: number;
  cancelled: number;
  lateCancelled: number;
}

export type StatField = keyof UserStats;

export const STAT_FIELDS: readonly StatField[] = ['attended', 'cancelled', 'lateCancelled'];

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatRow {
  message_id: string;
  author_user_id: string | null;
  body: string;
  system: boolean;
  triggered_by: string | null;
  created_at: string;
}

export interface ChatMessage {
  uid: string;            // '__system__' if `system` is true
  username: string;
  displayName: string;
  text: string;
  ts: number;
  system: boolean;
  triggeredBy?: string | null;
}

// ---------------------------------------------------------------------------
// Aggregate root state — used by handlers that genuinely need it (admin
// import/export, dev backup). Per-request handlers should NOT reach for this:
// each repository exposes the targeted reads they need.
// ---------------------------------------------------------------------------

export interface RootState {
  users: Record<string, PrivateUserProfile>;
  publicProfiles: Record<string, PublicUserProfile>;
  services: Record<string, Service>;
  stats: Record<string, UserStats>;
  chat: Record<string, ChatMessage>;
}

export function emptyRootState(): RootState {
  return {
    users: {},
    publicProfiles: {},
    services: {},
    stats: {},
    chat: {}
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isValidUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME_RE.test(value);
}

export function isValidColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR_RE.test(value);
}

export function isValidRole(value: unknown): value is RoleId {
  return value === 'user' || value === 'admin' || value === 'dev';
}

export function isValidStatField(value: unknown): value is StatField {
  return value === 'attended' || value === 'cancelled' || value === 'lateCancelled';
}
