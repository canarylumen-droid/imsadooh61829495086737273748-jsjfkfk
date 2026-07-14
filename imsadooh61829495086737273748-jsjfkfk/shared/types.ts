// ========== COMMON TYPE ALIASES ==========
export type SubscriptionTier = 'free' | 'trial' | 'starter' | 'pro' | 'enterprise';
export type PlanType = 'trial' | 'starter' | 'pro' | 'enterprise';
export type ChannelType = 'email' | 'instagram';
export type ProviderType = 'instagram' | 'gmail' | 'email' | 'system';
export type LeadStatus = 'new' | 'contacted' | 'replied' | 'converted' | 'not_interested' | 'cold' | 'qualified';
export type MessageDirection = 'inbound' | 'outbound';
export type DealStatus = 'open' | 'closed_won' | 'closed_lost' | 'pending';
export type ReplyTone = 'friendly' | 'professional' | 'short';
export type UserRole = 'admin' | 'member';

// ========== CONVERSATION & MESSAGE TYPES ==========
export interface ConversationMessage {
  id: string;
  leadId: string;
  userId: string;
  provider: ProviderType;
  direction: MessageDirection;
  body: string;
  audioUrl?: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
  // Computed helper fields for AI processing
  role?: 'user' | 'assistant' | 'system';
}

export interface LeadProfile {
  id: string;
  userId: string;
  name: string;
  firstName: string;
  email?: string | null;
  phone?: string | null;
  channel: ChannelType;
  status: LeadStatus;
  score: number;
  warm: boolean;
  sentiment?: 'positive' | 'neutral' | 'negative' | null;
  lastMessagePreview?: string | null;
  company?: string;
  industry?: string;
  tags: string[];
  metadata: Record<string, any>;
  organizationId?: string | null;
  verified?: boolean;
  verifiedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastEnrichedAt?: Date | null;
  lastMessageAt?: Date | null;
  aiPaused: boolean;
  pdfConfidence?: number | null;
  externalId?: string | null;
  timezone?: string;
  calendlyLink?: string | null;
  fathomMeetingId?: string | null;
}

// ========== QUEUE & WORKER TYPES ==========
export interface QueueJob<T = Record<string, any>> {
  id: string;
  type: string;
  payload: T;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  processedAt?: Date;
  error?: string;
  createdAt: Date;
}

export interface FollowUpJobPayload {
  leadId: string;
  userId: string;
  channel: ChannelType;
  campaignDay: number;
  temperature: 'hot' | 'warm' | 'cold';
  sequenceNumber: number;
  previousStatus?: LeadStatus;
}

export interface FollowUpTask {
  id: string;
  userId: string;
  leadId: string;
  channel: ChannelType;
  scheduledAt: Date;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  lastError?: string;
  context: FollowUpJobPayload | Record<string, any>;
}

export interface WorkerHealthStatus {
  name: string;
  isRunning: boolean;
  lastHeartbeat?: Date;
  processedCount: number;
  errorCount: number;
  avgProcessingTime?: number;
}

// ========== AI & RESPONSE TYPES ==========
export interface AIResponse {
  content: string;
  reasoning?: string;
  suggestedActions?: string[];
  confidence?: number;
}

export interface ObjectionResponse {
  reply: string;
  confidence: number;
  reasoning: string;
  objectionType?: string;
  suggestedFollowUp?: string;
}

export interface SalesContext {
  leadName: string;
  firstName: string;
  company?: string;
  industry?: string;
  previousMessages: ConversationMessage[];
  brandContext: BrandContext;
  campaignDay: number;
  temperature: 'hot' | 'warm' | 'cold';
}

export interface BrandContext {
  businessName: string;
  voiceRules?: string;
  brandColors?: string;
  brandSnippets?: string[];
  senderName?: string;
  productInfo?: {
    name?: string;
    description?: string;
    price?: string;
    features?: string[];
    benefits?: string[];
  };
}

// ========== EMAIL & DELIVERY TYPES ==========
export interface EmailJob {
  id: string;
  userId: string;
  to: string;
  from: string;
  subject: string;
  body: string;
  html?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  priority: 'high' | 'normal' | 'low';
  scheduledAt?: Date;
  metadata?: Record<string, any>;
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface EmailDeliveryResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
  timestamp: Date;
  bounced?: boolean;
  delivered?: boolean;
}

export interface ProviderResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  provider: string;
  statusCode?: number;
  retryable?: boolean;
}

// ========== AUTH & OTP TYPES ==========
export interface OTPVerificationResult {
  success: boolean;
  userId?: string;
  error?: string;
  remainingAttempts?: number;
  expiresAt?: Date;
}

export interface OAuthCredential {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string[];
  tokenType?: string;
  metadata?: Record<string, any>;
}

export interface SessionUser {
  id: string;
  email: string;
  username?: string;
  name?: string;
  role: UserRole;
  plan: PlanType;
  subscriptionTier?: SubscriptionTier;
  company?: string;
  avatar?: string;
}

// ========== API RESPONSE TYPES ==========
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    hasMore?: boolean;
  };
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

// ========== PDF PROCESSING TYPES ==========
export interface PDFProcessingResult {
  success: boolean;
  leadsCreated: number;
  text?: string;
  confidence?: number | null;
  missingFields?: string[];
  offerExtracted?: {
    productName: string;
    description: string;
    price?: string;
    link?: string;
    features: string[];
    benefits: string[];
    cta?: string;
    supportEmail?: string;
  };
  brandExtracted?: {
    colors: {
      primary?: string;
      secondary?: string;
      accent?: string;
    };
    companyName?: string;
    tagline?: string;
    website?: string;
  };
  leads?: Array<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
    company?: string;
  }>;
  error?: string;
}

// ========== ANALYTICS & INSIGHTS TYPES ==========
export interface LeadInsights {
  totalLeads: number;
  newLeads: number;
  convertedLeads: number;
  conversionRate: number;
  avgResponseTime: number;
  topChannels: { channel: ChannelType; count: number }[];
  hotLeads: number;
  warmLeads: number;
  coldLeads: number;
}

export interface WeeklyInsight {
  userId: string;
  weekStart: Date;
  weekEnd: Date;
  metrics: LeadInsights;
  aiSummary: string;
  recommendations: string[];
  generatedAt: Date;
}

// ========== CALENDAR & BOOKING TYPES ==========
export interface CalendarSlot {
  start: Date;
  end: Date;
  available: boolean;
}

export interface BookingRequest {
  leadId: string;
  userId: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  attendeeEmail: string;
  attendeeName: string;
  meetingUrl?: string;
}

export interface BookingResult {
  success: boolean;
  eventId?: string;
  meetingUrl?: string;
  error?: string;
  calendarProvider?: string;
}

// ========== WEBHOOK & INTEGRATION TYPES ==========
export interface WebhookPayload {
  event: string;
  timestamp: Date;
  data: Record<string, any>;
  signature?: string;
}

export interface IntegrationStatus {
  provider: string;
  connected: boolean;
  lastSync?: Date;
  error?: string;
  accountInfo?: {
    id?: string;
    name?: string;
    email?: string;
  };
}
