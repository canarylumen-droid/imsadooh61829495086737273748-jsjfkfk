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
  id: string;
  email: string;
  subject: string | null;
  intent: "Converted" | "Ghosted" | "Not-Interested" | "Reply-Needed";
  deliverabilityStatus: "safe" | "risky" | "invalid" | "unknown";
  followUpDraft?: string | null;
  mailboxId?: string;
  sourceMailboxProvider?: string | null;
  sourceMailboxAccountType?: string | null;
  conversationSummary?: string | null;
  lastMessageText?: string | null;
  lastMessageAt?: string | null;
  brainstormedObjections?: Array<{
    category: string;
    rule: string;
    evidence?: string;
    syncedAt?: string;
  }> | null;
  createdAt: string;
}

export interface RecoveryEventLog {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
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
  selectedMailboxId: string;
  draftModalOpen: boolean;
  loading: boolean;
  warningOpen: boolean;
  error: string | null;
  statusMessage: string;
  loadAll: () => Promise<void>;
  activate: (mailboxId?: string) => Promise<void>;
  deactivate: () => Promise<void>;
  syncNow: (mailboxId?: string) => Promise<void>;
  recoverLead: (leadId: string) => Promise<void>;
  syncObjections: (leadIds?: string[]) => Promise<number>;
  sendRecovery: (leadId: string) => Promise<string | null>;
  setSelectedLead: (lead: RecoveredLead | null) => void;
  setSelectedMailboxId: (id: string) => void;
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
  const [selectedMailboxId, setSelectedMailboxId] = useState("all");
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/lead-recovery/status", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) {
          setError('Upgrade to Pro for AI-powered recovery of cold leads, missed replies, and dormant conversations.');
          return;
        }
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status}: ${text}`);
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
      if (msg.includes('Pro plan') || msg.includes('403')) {
        setError('Upgrade to Pro for AI-powered recovery of cold leads, missed replies, and dormant conversations.');
        return;
      }
      setError(msg);
      console.warn('[LeadRecovery] Failed to load status:', e);
    }
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      const params = selectedMailboxId !== "all" ? `?mailboxId=${encodeURIComponent(selectedMailboxId)}` : "";
      const res = await fetch(`/api/lead-recovery/leads${params}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) { setLeads([]); return; }
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status}: ${text}`);
      }
      const data = await res.json();
      setLeads(data.leads || []);
    } catch (e) {
      console.warn('[LeadRecovery] Failed to load leads:', e);
    }
  }, [selectedMailboxId]);

  const loadEvents = useCallback(async () => {
    try {
      const params = selectedMailboxId !== "all" ? `?mailboxId=${encodeURIComponent(selectedMailboxId)}` : "";
      const res = await fetch(`/api/lead-recovery/events${params}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) { setEvents([]); return; }
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${res.status}: ${text}`);
      }
      const data = await res.json();
      setEvents(data.events || []);
    } catch (e) {
      console.warn('[LeadRecovery] Failed to load events:', e);
    }
  }, [selectedMailboxId]);

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
    setStatusMessage("Starting...");
    try {
      await apiRequest("POST", "/api/lead-recovery/activate", mailboxId ? { mailboxId } : {});
      setStatusMessage("Scheduling...");
      await loadAll();
      setStatusMessage("Active");
      toast({ title: "Lead Recovery Activated" });
    } catch (e) {
      console.warn('[LeadRecovery] Activate failed:', e);
      setStatusMessage("");
      toast({ title: 'Failed to activate lead recovery', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const deactivate = useCallback(async () => {
    setLoading(true);
    setStatusMessage("Deactivating...");
    try {
      await apiRequest("POST", "/api/lead-recovery/deactivate", {});
      await loadAll();
      setStatusMessage("");
      toast({ title: "Lead Recovery Deactivated" });
    } catch (e) {
      console.warn('[LeadRecovery] Deactivate failed:', e);
      setStatusMessage("");
      toast({ title: 'Failed to deactivate lead recovery', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const syncNow = useCallback(async (mailboxId?: string) => {
    setLoading(true);
    setStatusMessage("Queuing...");
    try {
      await apiRequest("POST", "/api/lead-recovery/sync", mailboxId ? { mailboxId } : {});
      setStatusMessage("Syncing mailboxes...");
      await new Promise(r => setTimeout(r, 2000));
      await loadAll();
      setStatusMessage("Checking results...");
      await new Promise(r => setTimeout(r, 1000));
      // leads state updated by loadAll — show generic ready message
      setStatusMessage("Sync complete");
      toast({ title: "Sync complete", description: "Check Recoverable Leads section" });
    } catch (e) {
      console.warn('[LeadRecovery] Sync failed:', e);
      setStatusMessage("");
      toast({ title: 'Failed to sync lead recovery', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadAll]);

  const recoverLead = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/lead-recovery/recover/${leadId}`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || err.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSelectedLead(data.lead);
      setDraftModalOpen(true);
      await Promise.all([loadLeads(), loadEvents()]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('[LeadRecovery] Recover failed:', e);
      toast({ title: 'Failed to recover lead', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [loadLeads, loadEvents]);

  const sendRecovery = useCallback(async (leadId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/lead-recovery/send/${leadId}`, {});
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || err.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      await Promise.all([loadLeads(), loadEvents()]);
      toast({ title: "Recovery sent", description: "Draft sent as reply to the original thread." });
      return data.leadId || null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      toast({ title: 'Failed to send recovery', description: msg, variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
      setDraftModalOpen(false);
    }
  }, [loadLeads, loadEvents]);

  const syncObjections = useCallback(async (leadIds?: string[]) => {
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/lead-recovery/brainstorm-sync", { leadIds });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || err.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      await Promise.all([loadLeads(), loadEvents()]);
      return Number(data.synced || 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.warn('[LeadRecovery] Sync objections failed:', e);
      toast({ title: 'Failed to sync objections', description: msg, variant: 'destructive' });
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
    selectedMailboxId,
    draftModalOpen,
    loading,
    warningOpen,
    error,
    statusMessage,
    loadAll,
    activate,
    deactivate,
    syncNow,
    recoverLead,
    syncObjections,
    sendRecovery,
    setSelectedLead,
    setSelectedMailboxId,
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
    selectedMailboxId,
    draftModalOpen,
    loading,
    warningOpen,
    error,
    statusMessage,
    loadAll,
    activate,
    deactivate,
    syncNow,
    recoverLead,
    syncObjections,
    sendRecovery,
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
