/**
 * DAL — Row ↔ Domain mappers.
 *
 * Two design rules:
 *   - Mappers are total: never throw. If a row is missing a value, the mapper
 *     fills a sane default. Validation belongs in handlers, not here.
 *   - Mappers are pure: no clock reads except the explicit `now` argument
 *     in row builders, no env reads. Easy to unit-test.
 */

import {
  type AttendeeRow, type Attendee,
  type ChatRow, type ChatMessage,
  type ServiceRow, type Service,
  type StatsRow, type UserStats,
  type UserRow, type PrivateUserProfile, type PublicUserProfile,
  type RoleId,
  isUuid, isValidColor, isValidRole
} from './types.js';

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export function userRowToProfile(row: UserRow): PrivateUserProfile {
  return {
    username: row.username,
    email: row.email,
    displayName: row.display_name || row.username,
    role: row.role_id || 'user',
    mustChangePassword: !!row.must_change_password,
    createdAt: isoToMs(row.created_at)
  };
}

export function userRowToPublic(row: UserRow): PublicUserProfile {
  return {
    username: row.username,
    displayName: row.display_name || row.username
  };
}

export function profileToUserRow(uid: string, profile: Partial<PrivateUserProfile>, now: number = Date.now()): UserRow {
  const username = String(profile.username || '').trim().toLowerCase();
  const role: RoleId = isValidRole(profile.role) ? profile.role : 'user';
  return {
    user_id: uid,
    username,
    email: String(profile.email || (username ? username + '@minis-wettstetten.de' : '')).toLowerCase(),
    display_name: String(profile.displayName || username || uid).slice(0, 60),
    role_id: role,
    must_change_password: profile.mustChangePassword === false ? false : true,
    created_at: msToIso(profile.createdAt, now)
  };
}

// ---------------------------------------------------------------------------
// Service / attendees
// ---------------------------------------------------------------------------

export function serviceRowToModel(row: ServiceRow): Service {
  return {
    title: row.title,
    description: row.description || '',
    startMs: isoToMs(row.start_at),
    deadlineDays: row.deadline_days || 0,
    minSlots: row.min_slots || 1,
    color: row.color || '#0066cc',
    replacement: !!row.replacement_needed,
    statsApplied: !!row.stats_applied,
    createdBy: row.created_by || null,
    createdAt: isoToMs(row.created_at),
    attendees: {}
  };
}

export function serviceToRow(serviceId: string, service: Partial<Service>, now: number = Date.now()): ServiceRow {
  return {
    service_id: serviceId,
    title: String(service.title || '').slice(0, 120),
    description: String(service.description || '').slice(0, 1200),
    start_at: msToIso(service.startMs, now),
    deadline_days: clampInt(service.deadlineDays, 0, 30, 0),
    min_slots: clampInt(service.minSlots, 1, 50, 1),
    color: isValidColor(service.color) ? service.color : '#0066cc',
    replacement_needed: !!service.replacement,
    stats_applied: !!service.statsApplied,
    created_by: isUuid(service.createdBy) ? service.createdBy : null,
    created_at: msToIso(service.createdAt, now)
  };
}

export function attendeeRowToModel(row: AttendeeRow, profile?: { username?: string; displayName?: string }): Attendee {
  return {
    uid: row.user_id,
    username: profile?.username || '',
    displayName: profile?.displayName || profile?.username || '',
    ts: isoToMs(row.signed_up_at)
  };
}

export function attendeeToRow(serviceId: string, attendee: { uid: string; ts?: number }, now: number = Date.now()): AttendeeRow {
  return {
    service_id: serviceId,
    user_id: attendee.uid,
    signed_up_at: msToIso(attendee.ts, now)
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function statsRowToModel(row: StatsRow): UserStats {
  return {
    attended: row.attended || 0,
    cancelled: row.cancelled || 0,
    lateCancelled: row.late_cancelled || 0
  };
}

export function statsToRow(uid: string, stats: Partial<UserStats>): StatsRow {
  return {
    user_id: uid,
    attended: nonNegativeInt(stats.attended),
    cancelled: nonNegativeInt(stats.cancelled),
    late_cancelled: nonNegativeInt(stats.lateCancelled)
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function chatRowToModel(
  row: ChatRow,
  authors: Readonly<Record<string, { username: string; displayName: string }>> = {}
): ChatMessage {
  if (row.system) {
    return {
      uid: '__system__',
      username: 'SYSTEM',
      displayName: 'SYSTEM',
      text: row.body,
      ts: isoToMs(row.created_at),
      system: true,
      triggeredBy: row.triggered_by || null
    };
  }
  const authorId = row.author_user_id || '';
  const profile = authors[authorId];
  return {
    uid: authorId,
    username: profile?.username || '',
    displayName: profile?.displayName || profile?.username || '',
    text: row.body,
    ts: isoToMs(row.created_at),
    system: false
  };
}

export function chatToRow(messageId: string, message: Partial<ChatMessage>, now: number = Date.now()): ChatRow {
  const isSystem = !!message.system;
  return {
    message_id: messageId,
    author_user_id: !isSystem && isUuid(message.uid) ? message.uid : null,
    body: String(message.text || '').slice(0, 2000),
    system: isSystem,
    triggered_by: isUuid(message.triggeredBy) ? message.triggeredBy : null,
    created_at: msToIso(message.ts, now)
  };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function isoToMs(value: string | null | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function msToIso(value: number | null | undefined, fallback: number = Date.now()): string {
  const ms = Number(value);
  if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  return new Date(fallback).toISOString();
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}
