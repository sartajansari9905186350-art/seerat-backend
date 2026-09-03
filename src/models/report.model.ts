export type ReportReason =
  | 'WRONG_INFO'
  | 'INAPPROPRIATE'
  | 'SPAM'
  | 'HARASSMENT'
  | 'COPYRIGHT'
  | 'FAKE_ACCOUNT'
  | 'OTHER';

export type ReportStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED';
export type ReportTargetType = 'POST' | 'REEL' | 'USER' | 'COMMENT';

export interface Report {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  action_taken?: string;
  resolved_by?: string;
  resolution_notes?: string;
  created_at: Date;
  updated_at: Date;
  resolved_at?: Date;
}
