/** Readiness dependencies, grouped by provider and schema responsibility. */
export const HEALTH_CONTRACT = {
  database: {
    rowLimit: 1,
    roles: ['user', 'admin', 'dev'],
    tables: {
      app_roles: ['role_id', 'role_rank', 'display_label'],
      app_users: ['user_id', 'username', 'email', 'display_name', 'role_id', 'must_change_password', 'created_at'],
      service_events: ['service_id', 'title', 'description', 'start_at', 'deadline_days', 'min_slots', 'color', 'replacement_needed', 'stats_applied', 'created_by', 'created_at'],
      service_attendees: ['service_id', 'user_id', 'signed_up_at'],
      user_stats: ['user_id', 'attended', 'cancelled', 'late_cancelled'],
      chat_messages: ['message_id', 'author_user_id', 'body', 'system', 'triggered_by', 'created_at']
    },
    functions: [
      'increment_user_stat', 'set_user_stat', 'replace_stats', 'replace_attendees_of',
      'upsert_service_with_attendees', 'replace_services', 'replace_chat', 'replace_root_state'
    ]
  }
} as const;
