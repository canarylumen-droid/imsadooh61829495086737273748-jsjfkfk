import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { toast } from '@/hooks/use-toast';

export interface LeadRecoveryMailbox {
  id: string;
  provider: string;
  accountType?: string | null;
  healthStatus?: string;
  reputationScore?: number;
  isBusy: boolean;
  availableAt: string | null;
  activeCampaignIds: string[];
  isRecoveryActive?: boolean;
  lastSyncAt?: string | null;
  syncRequestedAt?: string | null;
  syncStatus?: "idle" | "queued" | "syncing" | "completed" | "failed";
  errorMessage?: string | null;
}

export interface RecoveredLead {
  _id: string;
  email: string;
  subject: string;
  intent: "Converted" | "Ghosted" | "Not-Interested" | "Reply-Needed";
  deliverabilityStatus: "safe" | "risky" | "invalid" | "unknown";
  followUpDraft?: string;
  mailboxId?: string;
  sourceMailboxSnapshot?: {
    provider?: string;
    accountType?: string;
  };
  conversationSummary?: string;
  lastMessageText?: string;
  lastMessageAt?: string;
  brainstormedObjections?: Array<{
    category: string;
    rule: string;
    evidence?: string;
    syncedAt?: string;
  }>;
  createdAt: string;
}

export interface RecoveryEventLog {
  _id: string;
  action: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

interface LeadRecoveryState {
  isActive: boolean;
  hasAvailableMailbox: boolean;
  availableAt: string | null;
  mailboxDetails: LeadRecoveryMailbox[];
  skipWarning: string;
  promptConfigured: boolean;
  leads: RecoveredLead[];
  events: RecoveryEventLog[];
  selectedLead: RecoveredLead | null;
  draftModalOpen: boolean;
  loading: boolean;
  warningOpen: boolean;
  error: string | null;
  loadAll: () => Promise<void>;
  activate: (mailboxId?: string) => Promise<void>;
  deactivate: () => Promise<void>;
  syncNow: (mailboxId?: string) => Promise<void>;
  recoverLead: (leadId: string) => Promise<void>;
  syncObjections: (leadIds?: string[]) => Promise<number>;
  setSelectedLead: (lead: RecoveredLead | null) => void;
  setDraftModalOpen: (open: boolean) => void;
  setWarningOpen: (open: boolean) => void;
}

const LeadRecoveryContext = createContext<LeadRecoveryState | null>(null);

export function LeadRecoveryProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [hasAvailableMailbox, setHasAvailableMailbox] = useState(false);
  const [availableAt, setAvailableAt] = useState<string | null>(null);
  const [mailboxDetails, setMailboxDetails] = useState<LeadRecoveryMailbox[]>([]);
  const [skipWarning, setSkipWarning] = useState("");
  const [promptConfigured, setPromptConfigured] = useState(false);
  const [leads, setLeads] = useState<RecoveredLead[]>([]);
  const [events, setEvents] = useState<RecoveryEventLog[]>([]);
  const [selectedLead, setSelectedLead] = useState<RecoveredLead | null>(null);
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/lead-recovery/status");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const msg = err.error || err.message || `HTTP ${res.status}`;
        if (res.status === 403 && msg === 'Pro plan required') {
          setError('Lead Recovery is available on Pro and Enterprise plans. Upgrade to unlock.');
        } else if (res.status === 403) {
          setError(msg);
        } else {
          throw new Error(msg);
        }
        return;
      }
      const data = await res.json();
      setError(null);
      setIsActive(data.isActive);
      setHasAvailableMailbox(data.hasAvailableMailbox);
      setAvailableAt(data.availableAt);
      setMailboxDetails(data.mailboxDetails || []);
      setSkipWarning(data.skipWarning || "");
      setPromptConfigured(Boolean(data.promptConfigured));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      console.warn('[LeadRecovery] Failed to load status:', e);
      toast({ title: 'Failed to load recovery status', description: msg, variant: 'destructive' });
    }
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/lead-recovery/leads");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (e) {
      console.warn('[LeadRecovery] Failed to load leads:', e);
      toast({ title: 'Failed to load recovery leads', variant: 'destructive' });
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const res = await apiRequest("GET", "/api/lead-recovery/events");
      const data = await res.json();
      setEvents(data.events || []);
    } catch (e) {
      console.warn('[LeadRecovery] Failed to load events:', e);
      toast({ title: 'Failed to load recovery events', variant: 'destructive' });
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, leadsRes, eventsRes] = await Promise.allSettled([loadStatus(), loadLeads(), loadEvents()]);
      const failures = [statusRes, leadsRes, eventsRes].filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.warn(`[LeadRecovery] ${failures.length}/3 calls failed`);
      }
    } finally {
      setLoading(false);
    }
  }, [loadStatus, loadLeads, loadEvents]);

  const activate = useCallback(async (mailboxId?: string) => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/lead-recovery/activate", mailboxId ? { mailboxId } : {});
      await loadAll();
    } catch (e) {
      console.warn('[LeadRecovery] Activate failed:', e);
      toast({ title: 'Failed to activate lead recovery', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const deactivate = useCallback(async () => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/lead-recovery/deactivate", {});
      await loadAll();
    } catch (e) {
      console.warn('[LeadRecovery] Deactivate failed:', e);
      toast({ title: 'Failed to deactivate lead recovery', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const syncNow = useCallback(async (mailboxId?: string) => {
    setLoading(true);
    try {
      await apiRequest("POST", "/api/lead-recovery/sync", mailboxId ? { mailboxId } : {});
      await loadAll();
    } catch (e) {
      console.warn('[LeadRecovery] Sync failed:', e);
      toast({ title: 'Failed to sync lead recovery', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const recoverLead = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/lead-recovery/recover/${leadId}`, {});
      const data = await res.json();
      setSelectedLead(data.lead);
      setDraftModalOpen(true);
      await Promise.all([loadLeads(), loadEvents()]);
    } catch (e) {
      console.warn('[LeadRecovery] Recover failed:', e);
      toast({ title: 'Failed to recover lead', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadLeads, loadEvents]);

  const syncObjections = useCallback(async (leadIds?: string[]) => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/lead-recovery/brainstorm-sync", { leadIds });
      const data = await res.json();
      await Promise.all([loadLeads(), loadEvents()]);
      return Number(data.synced || 0);
    } catch (e) {
      console.warn('[LeadRecovery] Sync objections failed:', e);
      toast({ title: 'Failed to sync objections', variant: 'destructive' });
      return 0;
    } finally {
      setLoading(false);
    }
  }, [loadLeads, loadEvents]);

  const value = useMemo<LeadRecoveryState>(() => ({
    isActive,
    hasAvailableMailbox,
    availableAt,
    mailboxDetails,
    skipWarning,
    promptConfigured,
    leads,
    events,
    selectedLead,
    draftModalOpen,
    loading,
    warningOpen,
    error,
    loadAll,
    activate,
    deactivate,
    syncNow,
    recoverLead,
    syncObjections,
    setSelectedLead,
    setDraftModalOpen,
    setWarningOpen,
  }), [
    isActive,
    hasAvailableMailbox,
    availableAt,
    mailboxDetails,
    skipWarning,
    promptConfigured,
    leads,
    events,
    selectedLead,
    draftModalOpen,
    loading,
    warningOpen,
    error,
    loadAll,
    activate,
    deactivate,
    syncNow,
    recoverLead,
    syncObjections,
  ]);

  return <LeadRecoveryContext.Provider value={value}>{children}</LeadRecoveryContext.Provider>;
}

export function useLeadRecoveryStore() {
  const context = useContext(LeadRecoveryContext);
  if (!context) {
    throw new Error("useLeadRecoveryStore must be used within LeadRecoveryProvider");
  }
  return context;
}
