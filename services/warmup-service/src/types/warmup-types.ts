/**
 * P2P Email Warmup Service — TypeScript types
 * Strictly isolated from the main app. No references to messages, campaign_leads, etc.
 */

import type { WarmupMailbox, WarmupThread, WarmupInteraction } from '@audnix/shared';

export type PoolType = 'enterprise' | 'global';
export type WarmupStatus = 'active' | 'paused' | 'unenrolled' | 'error';
export type ThreadStatus = 'active' | 'completed' | 'stalled' | 'error';
export type InteractionDirection = 'outbound' | 'inbound';
export type InteractionStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'expunged';
export type PauseReason =
  | 'single_mailbox_enterprise'
  | 'empty_global_pool'
  | 'user_disabled'
  | 'daily_limit_reached'
  | 'imap_error'
  | 'smtp_error'
  | 'empty_pool_defensive';

export interface PairingCandidate {
  mailboxId: string;
  email: string;
  provider: string;
  organizationId: string | null;
  dailySentCount: number;
  dailyReceivedCount: number;
  activeThreadCount: number;
  lastInteractionAt: Date | null;
  score?: number;
}

export interface ThreadContext {
  threadId: string;
  subject: string;
  previousMessages: Array<{
    direction: InteractionDirection;
    body: string;
    sentAt: Date | null;
  }>;
  volleyNumber: number;
}

export interface SmtpCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}

export interface SmtpSendResult {
  success: boolean;
  smtpMessageId?: string;
  error?: string;
}

export interface ImapCredentials {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
}

export interface WarmupJobPayload {
  threadId?: string;
  interactionId?: string;
  mailboxId?: string;
  senderMailboxId?: string;
  recipientMailboxId?: string;
  messageId?: string;
  xAudnixWarmup?: string;
  expectedMessageId?: string;
}

export interface EnrollmentCriteria {
  userId: string;
  integrationId: string;
  email: string;
  provider: 'gmail' | 'outlook' | 'custom_email';
  connected: boolean;
  healthStatus: string;
  plan: string;
  subscriptionTier: string | null;
  organizationId: string | null;
  warmupEnabled: boolean;
}

export { WarmupMailbox, WarmupThread, WarmupInteraction };
