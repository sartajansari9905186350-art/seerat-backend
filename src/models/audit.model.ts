export type AuditAction =
  | 'APPROVED_CONTENT'
  | 'REJECTED_CONTENT'
  | 'REMOVED_CONTENT'
  | 'RESTORED_CONTENT'
  | 'FLAGGED_CONTENT'
  | 'SUSPENDED_USER'
  | 'UNSUSPENDED_USER'
  | 'DISABLED_USER'
  | 'WARNED_USER'
  | 'BANNED_USER'
  | 'RESTORED_USER'
  | 'RESOLVED_REPORT'
  | 'DISMISSED_REPORT'
  | 'CREATED_ADMIN'
  | 'UPDATED_ADMIN'
  | 'DELETED_ADMIN'
  | 'CHANGED_SETTINGS'
  | 'ADMIN_LOGIN'
  | 'ADMIN_LOGOUT';

export type AuditTargetType = 'POST' | 'REEL' | 'USER' | 'REPORT' | 'ADMIN' | 'SETTINGS' | 'CONTENT';

export interface AdminAuditLog {
  id: string;
  admin_id?: string;
  admin_name: string;
  admin_email: string;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id?: string;
  reason?: string;
  details?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  created_at: Date;
}
