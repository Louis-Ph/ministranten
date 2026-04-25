/**
 * ServicesRepository — owns `service_events` and `service_attendees`.
 *
 * Services + their attendees are a single aggregate: there is no business
 * reason to operate on attendees without their parent service. So this
 * repository owns both tables together.
 *
 * Multi-row replacements (`replaceAll`, `replaceAttendeesOf`) are routed
 * through Postgres functions so they execute in a single transaction.
 * Single-row writes use direct PostgREST.
 */

import { getSupabase, filter } from '../supabase.js';
import {
  attendeeToRow,
  serviceRowToModel, serviceToRow,
  isoToMs
} from '../mappers.js';
import {
  type AttendeeRow, type Attendee,
  type ServiceRow, type Service,
  type PublicUserProfile,
  isUuid
} from '../types.js';
import { badRequest } from '../errors.js';
import { createLogger } from '../logger.js';

const log = createLogger('repo.services');
const TABLE_SERVICES = 'service_events';
const TABLE_ATTENDEES = 'service_attendees';
const SERVICE_COLS = 'service_id,title,description,start_at,deadline_days,min_slots,color,replacement_needed,stats_applied,created_by,created_at';

const FIELD_MAP: Readonly<Record<string, string>> = Object.freeze({
  title: 'title',
  description: 'description',
  startMs: 'start_at',
  deadlineDays: 'deadline_days',
  minSlots: 'min_slots',
  color: 'color',
  replacement: 'replacement_needed',
  statsApplied: 'stats_applied',
  createdBy: 'created_by',
  createdAt: 'created_at'
});

export interface ServicesRepository {
  /** Returns all services keyed by service-id, with their attendees joined in. */
  listAll(authors?: Readonly<Record<string, PublicUserProfile>>): Promise<Record<string, Service>>;
  /** Returns one service with attendees, or `null`. */
  getById(serviceId: string, authors?: Readonly<Record<string, PublicUserProfile>>): Promise<Service | null>;
  /** Upserts one service. If `replaceAttendees` is true, attendees of that one
   *  service are replaced atomically via RPC. */
  upsert(serviceId: string, service: Partial<Service>, opts?: { replaceAttendees?: boolean }): Promise<void>;
  /** Patches one field of one service. */
  patchField<K extends keyof typeof FIELD_MAP>(serviceId: string, field: K, value: unknown): Promise<void>;
  /** Hard-delete one service (cascades to attendees via FK). */
  remove(serviceId: string): Promise<void>;
  /** Adds or replaces a single attendee on a service. */
  upsertAttendee(serviceId: string, attendee: Attendee): Promise<void>;
  /** Removes one attendee from one service. */
  removeAttendee(serviceId: string, userId: string): Promise<void>;
  /** Replaces every attendee of one service in a single transaction. */
  replaceAttendeesOf(serviceId: string, attendees: readonly Attendee[]): Promise<void>;
  /** Atomically replaces ALL services + attendees. Used by admin import. */
  replaceAll(services: Readonly<Record<string, Service>>): Promise<void>;
}

export function createServicesRepository(): ServicesRepository {
  const sb = getSupabase();

  return {
    async listAll(authors = {}) {
      const [serviceRows, attendeeRows] = await Promise.all([
        sb.rest.select<ServiceRow>(TABLE_SERVICES, 'select=' + SERVICE_COLS + '&order=start_at.asc'),
        sb.rest.select<AttendeeRow>(TABLE_ATTENDEES, 'select=service_id,user_id,signed_up_at&order=signed_up_at.asc')
      ]);
      const out: Record<string, Service> = {};
      for (const row of serviceRows) out[row.service_id] = serviceRowToModel(row);
      for (const row of attendeeRows) {
        const service = out[row.service_id];
        if (!service) continue;
        const profile = authors[row.user_id];
        service.attendees[row.user_id] = {
          uid: row.user_id,
          username: profile?.username || '',
          displayName: profile?.displayName || profile?.username || '',
          ts: isoToMs(row.signed_up_at)
        };
      }
      return out;
    },

    async getById(serviceId, authors = {}) {
      if (!serviceId) return null;
      const [serviceRows, attendeeRows] = await Promise.all([
        sb.rest.select<ServiceRow>(TABLE_SERVICES, 'select=' + SERVICE_COLS + '&' + filter.eq('service_id', serviceId) + '&limit=1'),
        sb.rest.select<AttendeeRow>(TABLE_ATTENDEES, 'select=service_id,user_id,signed_up_at&' + filter.eq('service_id', serviceId))
      ]);
      if (!serviceRows.length) return null;
      const service = serviceRowToModel(serviceRows[0]);
      for (const row of attendeeRows) {
        const profile = authors[row.user_id];
        service.attendees[row.user_id] = {
          uid: row.user_id,
          username: profile?.username || '',
          displayName: profile?.displayName || profile?.username || '',
          ts: isoToMs(row.signed_up_at)
        };
      }
      return service;
    },

    async upsert(serviceId, service, opts = {}) {
      if (!serviceId) throw badRequest('Missing service id', 'invalid_input');
      if (opts.replaceAttendees) {
        // Single transaction via RPC: upsert + delete-all-attendees + insert-attendees.
        const attendeeRows = Object.values(service.attendees || {})
          .filter(a => a && isUuid(a.uid))
          .map(a => attendeeToRow(serviceId, a));
        log.info('upsert.with_attendees', { serviceId, attendees: attendeeRows.length });
        await sb.rpc.call('upsert_service_with_attendees', {
          p_service_id: serviceId,
          p_service: serviceToRow(serviceId, service),
          p_attendees: attendeeRows
        });
        return;
      }
      log.info('upsert', { serviceId });
      await sb.rest.upsert<ServiceRow>(TABLE_SERVICES, serviceToRow(serviceId, service), {
        onConflict: 'service_id'
      });
    },

    async patchField(serviceId, field, value) {
      if (!serviceId) throw badRequest('Missing service id', 'invalid_input');
      const column = FIELD_MAP[field as string];
      if (!column) throw badRequest('Unknown service field: ' + String(field), 'invalid_input');
      let dbValue: unknown = value;
      if (field === 'startMs' || field === 'createdAt') {
        const ms = Number(value);
        dbValue = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString();
      }
      if (field === 'replacement' || field === 'statsApplied') dbValue = !!value;
      if (field === 'createdBy') dbValue = isUuid(value) ? value : null;
      log.info('patchField', { serviceId, field });
      await sb.rest.update<ServiceRow>(TABLE_SERVICES, filter.eq('service_id', serviceId), { [column]: dbValue });
    },

    async remove(serviceId) {
      if (!serviceId) throw badRequest('Missing service id', 'invalid_input');
      log.info('remove', { serviceId });
      await sb.rest.remove(TABLE_SERVICES, filter.eq('service_id', serviceId));
    },

    async upsertAttendee(serviceId, attendee) {
      if (!serviceId) throw badRequest('Missing service id', 'invalid_input');
      if (!isUuid(attendee.uid)) throw badRequest('Invalid attendee uid', 'invalid_input');
      log.debug('upsertAttendee', { serviceId, uid: attendee.uid });
      await sb.rest.upsert<AttendeeRow>(TABLE_ATTENDEES, attendeeToRow(serviceId, attendee), {
        onConflict: 'service_id,user_id'
      });
    },

    async removeAttendee(serviceId, userId) {
      if (!serviceId) throw badRequest('Missing service id', 'invalid_input');
      if (!isUuid(userId)) throw badRequest('Invalid user id', 'invalid_input');
      log.debug('removeAttendee', { serviceId, userId });
      await sb.rest.remove(TABLE_ATTENDEES,
        filter.and(filter.eq('service_id', serviceId), filter.eq('user_id', userId)));
    },

    async replaceAttendeesOf(serviceId, attendees) {
      if (!serviceId) throw badRequest('Missing service id', 'invalid_input');
      const rows = attendees
        .filter(a => a && isUuid(a.uid))
        .map(a => attendeeToRow(serviceId, a));
      log.info('replaceAttendeesOf', { serviceId, attendees: rows.length });
      await sb.rpc.call('replace_attendees_of', {
        p_service_id: serviceId,
        p_attendees: rows
      });
    },

    async replaceAll(services) {
      log.info('replaceAll', { count: Object.keys(services).length });
      // The RPC takes the entire `services` map as JSON and rebuilds atomically.
      // No window where the table is empty.
      await sb.rpc.call('replace_services', {
        p_services: services
      });
    }
  };
}
