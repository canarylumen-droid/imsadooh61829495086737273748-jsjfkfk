// Outreach Job Payload
export interface OutreachJobPayload {
  campaignId: number;
  leadId: number;
  userId: number;
  action: 'send_email' | 'check_reply' | 'follow_up';
  metadata?: Record<string, any>;
}

// RAG Job Payload
export interface RagJobPayload {
  documentId?: string | number; // Changed to string | number because UUIDs are used
  content?: string;
  action: 'index' | 'delete' | 'update' | 'search';
  metadata?: Record<string, any>;
  userId?: string;
  fileName?: string;
  query?: string;
  topK?: number;
}

// Mail Sync Job Payload
export interface MailSyncJobPayload {
  accountId: number;
  provider: 'gmail' | 'outlook' | 'imap';
  action: 'sync_inbox' | 'sync_sent';
  cursor?: string;
}

// Job Result Interfaces
export interface JobResult {
  success: boolean;
  message?: string;
  data?: any;
  error?: any;
}
