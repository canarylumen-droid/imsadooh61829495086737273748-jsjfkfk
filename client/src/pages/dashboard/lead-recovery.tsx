import { useEffect, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, Clock, Inbox, Mail, RefreshCw, ShieldCheck, Sparkles, DownloadCloud, Send, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LeadRecoveryProvider, useLeadRecoveryStore, type RecoveredLead } from "@/stores/leadRecoveryStore";
import { useRealtime } from "@/hooks/use-realtime";

function intentTone(intent: RecoveredLead["intent"]) {
  if (intent === "Converted") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  if (intent === "Reply-Needed") return "bg-primary/10 text-primary border-primary/20";
  if (intent === "Not-Interested") return "bg-red-500/10 text-red-500 border-red-500/20";
  return "bg-amber-500/10 text-amber-500 border-amber-500/20";
}

function LeadRecoveryContent() {
  const store = useLeadRecoveryStore();
  const { socket } = useRealtime();
  const [, setLocation] = useLocation();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [activateTarget, setActivateTarget] = useState<string>("all");
  const [sendingRecovery, setSendingRecovery] = useState(false);

  useEffect(() => {
    store.loadAll().catch(() => undefined);
    const retryTimer = setTimeout(() => {
      if (store.error && !store.error.includes('Request Timeout') && !store.error.includes('Pro plan')) {
        store.loadAll().catch(() => undefined);
      }
    }, 5000);
    return () => clearTimeout(retryTimer);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => store.loadAll().catch(() => undefined);
    socket.on('stats_updated', refresh);
    socket.on('leads_updated', refresh);
    socket.on('settings_updated', refresh);
    return () => {
      socket.off('stats_updated', refresh);
      socket.off('leads_updated', refresh);
      socket.off('settings_updated', refresh);
    };
  }, [socket, store.loadAll]);

  useEffect(() => {
    store.loadAll().catch(() => undefined);
  }, [store.selectedMailboxId]);

  const syncingMailboxes = store.mailboxDetails.filter((mailbox) => mailbox.syncStatus === "queued" || mailbox.syncStatus === "syncing").length;
  const completedMailboxes = store.mailboxDetails.filter((mailbox) => mailbox.syncStatus === 'completed').length;

  const handleToggleOn = () => {
    if (store.mailboxDetails.length <= 1) {
      store.activate().catch(() => undefined);
    } else {
      setActivateTarget("all");
      setActivateDialogOpen(true);
    }
  };

  const handleActivateConfirm = () => {
    setActivateDialogOpen(false);
    const mailboxId = activateTarget === "all" ? undefined : activateTarget;
    store.activate(mailboxId).catch(() => undefined);
  };

  const selectedMailbox = store.selectedMailboxId === "all" ? null : store.mailboxDetails.find(m => m.id === store.selectedMailboxId);

  return (
    <div className="space-y-6">
      {store.error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-red-500">Lead Recovery Unavailable</p>
            <p className="text-xs text-muted-foreground">{store.error.replace(/<[^>]+>/g, '')}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Lead Recovery</h1>
            <p className="text-sm text-muted-foreground">Email-only recovery for inactive prospects and missed replies.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/70 px-4 py-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Recovery</p>
            <p className="text-sm font-semibold">{store.isActive ? "Active" : "Inactive"}</p>
          </div>
          <Switch
            checked={store.isActive}
            disabled={store.loading}
            onCheckedChange={(checked) => { checked ? handleToggleOn() : setConfirmDeactivate(true); }}
          />
        </div>
      </div>

      {store.mailboxDetails.length > 1 && (
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-muted-foreground whitespace-nowrap">Viewing:</p>
          <Select value={store.selectedMailboxId} onValueChange={store.setSelectedMailboxId}>
            <SelectTrigger className="w-[220px] h-8 text-xs">
              <SelectValue placeholder="All Mailboxes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Mailboxes</SelectItem>
              {store.mailboxDetails.map((mb) => (
                <SelectItem key={mb.id} value={mb.id}>{mb.accountType || mb.provider}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedMailbox && (
            <Badge variant="outline" className={cn("text-[10px]", selectedMailbox.syncStatus === "completed" ? "border-emerald-500/30 text-emerald-500" : "text-muted-foreground")}>
              {selectedMailbox.syncStatus || "idle"}
            </Badge>
          )}
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <div className="rounded-lg border border-border/40 bg-card/70 p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs font-medium uppercase tracking-widest text-muted-foreground">Recoverable Leads</p>
          <p className="mt-1 text-2xl sm:text-3xl font-bold">{store.leads.length}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/70 p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs font-medium uppercase tracking-widest text-muted-foreground">Synced Mailboxes</p>
          <p className="mt-1 text-2xl sm:text-3xl font-bold">{completedMailboxes}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/70 p-3 sm:p-4 col-span-2 md:col-span-1">
          <p className="text-[10px] sm:text-xs font-medium uppercase tracking-widest text-muted-foreground">Audit Events</p>
          <p className="mt-1 text-2xl sm:text-3xl font-bold">{store.events.length}</p>
        </div>
      </div>

      {store.statusMessage && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10 text-xs text-primary">
          <RefreshCw className="h-3 w-3 animate-spin" />
          {store.statusMessage}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-border/40 bg-card/70">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border/30 p-4 gap-3">
            <div>
              <h2 className="font-semibold text-sm sm:text-base">Recoverable Leads</h2>
              <p className="text-[10px] sm:text-xs text-muted-foreground">Cold leads &amp; missed replies found in selected mailboxes.</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
              <Button variant="outline" size="sm" className="flex-1 sm:flex-initial text-xs" onClick={() => store.loadAll()} disabled={store.loading}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
              <Button size="sm" className="flex-1 sm:flex-initial text-xs" onClick={() => {
                const mbId = store.selectedMailboxId !== "all" ? store.selectedMailboxId : undefined;
                store.syncNow(mbId).catch(() => {});
              }} disabled={store.loading || store.mailboxDetails.length === 0}>
                <DownloadCloud className="mr-1.5 h-3.5 w-3.5" />
                {syncingMailboxes > 0 ? `Syncing ${syncingMailboxes}` : "Sync 90 days"}
              </Button>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {store.leads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 rounded-xl flex items-center justify-center mb-4">
                  {store.mailboxDetails.length === 0 ? (
                    <Inbox className="h-6 w-6 text-amber-400" />
                  ) : (
                    <RefreshCw className="h-6 w-6 text-amber-400" />
                  )}
                </div>
                {store.mailboxDetails.length === 0 ? (
                  <>
                    <p className="text-sm font-semibold text-foreground">No mailboxes connected</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Connect an email mailbox in Settings &gt; Integrations first, then return here to recover cold leads.
                    </p>
                  </>
                ) : !store.isActive ? (
                  <>
                    <p className="text-sm font-semibold text-foreground">Recovery is inactive</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Toggle the Recovery switch above to activate Lead Recovery, then click Sync 90 days to scan your mailboxes.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-foreground">No recoverable leads found</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Click Sync 90 days above to scan your connected mailboxes for missed replies and cold leads.
                    </p>
                  </>
                )}
              </div>
            ) : store.leads.map((lead) => (
              <div key={lead.id} className="grid gap-3 p-3 sm:p-4 grid-cols-2 md:grid-cols-[1fr_120px_120px_auto] md:items-center">
                <div className="min-w-0 col-span-2 md:col-span-1">
                  <p className="truncate text-xs sm:text-sm">{lead.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{lead.subject || "No subject"}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    Source: {lead.sourceMailboxAccountType || lead.sourceMailboxProvider || lead.mailboxId || "mailbox"}
                  </p>
                  {!!lead.brainstormedObjections?.length && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] sm:text-xs text-primary">
                      <Brain className="h-3 w-3 shrink-0" />
                      {lead.brainstormedObjections.length} objection{lead.brainstormedObjections.length === 1 ? "" : "s"} found
                    </div>
                  )}
                </div>
                <div className="flex items-center">
                  <Badge variant="outline" className={cn("text-[9px] sm:text-xs", intentTone(lead.intent))}>{lead.intent}</Badge>
                </div>
                <div className="flex items-center">
                  <Badge variant="outline" className="text-[9px] sm:text-xs capitalize">{lead.deliverabilityStatus}</Badge>
                </div>
                <Button size="sm" className="col-span-2 md:col-span-1 text-xs py-1.5 h-8 mt-1 md:mt-0" onClick={() => store.recoverLead(lead.id)}>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  Recover
                </Button>
              </div>
            ))}
          </div>
        </div>

          <div className="space-y-6">
          <div className="rounded-lg border border-border/40 bg-card/70 p-4">
            <h2 className="mb-3 font-semibold">Mailbox Status</h2>
            <div className="space-y-3">
              {store.mailboxDetails.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="text-xs font-semibold text-muted-foreground">No email mailboxes connected</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">Connect one in Settings → Integrations</p>
                </div>
              ) : store.mailboxDetails.map((mailbox) => (
                <div key={mailbox.id} className="rounded-lg border border-border/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{mailbox.accountType || mailbox.provider}</p>
                      <p className="text-xs text-muted-foreground">{mailbox.provider}</p>
                    </div>
                    {mailbox.isBusy ? <Clock className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  </div>
                    {mailbox.availableAt && <p className="mt-2 text-xs text-muted-foreground">Available {new Date(mailbox.availableAt).toLocaleString()}</p>}
                    {mailbox.errorMessage && mailbox.syncStatus === "failed" && (
                      <p className="mt-1 text-[10px] text-destructive/80 break-words">{mailbox.errorMessage}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <Badge variant="outline" className={cn("text-[10px] capitalize", mailbox.syncStatus === "failed" && "border-destructive/40 text-destructive")}>{mailbox.syncStatus || "idle"}</Badge>
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={() => store.syncNow(mailbox.id)}>
                      Sync
                    </Button>
                  </div>
                  {mailbox.lastSyncAt && <p className="mt-1 text-xs text-muted-foreground">Last sync {new Date(mailbox.lastSyncAt).toLocaleString()}</p>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border/40 bg-card/70 p-4">
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="font-semibold">Audit Log</h2>
            </div>
            <ScrollArea className="h-[320px] pr-3">
              <div className="space-y-3">
                {store.events.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <p className="text-xs font-semibold text-muted-foreground">No audit events yet</p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1">Events appear when you sync mailboxes or generate drafts</p>
                  </div>
                ) : store.events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-border/30 p-3">
                    <p className="text-sm font-medium">{event.action}</p>
                    <p className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

      <Dialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Deactivate Lead Recovery?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Synced leads and drafts will be saved, but no new mailboxes will be scanned until you reactivate.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setConfirmDeactivate(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { setConfirmDeactivate(false); store.deactivate(); }}>
                Deactivate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={activateDialogOpen} onOpenChange={setActivateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Activate Lead Recovery</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose which mailboxes to enable lead recovery for:</p>
            <div className="space-y-2">
              <label className="flex items-center gap-3 rounded-lg border border-border/40 p-3 cursor-pointer hover:bg-accent/50 transition-colors">
                <input type="radio" name="activateTarget" value="all" checked={activateTarget === "all"} onChange={() => setActivateTarget("all")} className="accent-primary" />
                <div>
                  <p className="text-sm font-medium">All Mailboxes</p>
                  <p className="text-xs text-muted-foreground">{store.mailboxDetails.length} mailboxes</p>
                </div>
              </label>
              {store.mailboxDetails.map((mb) => (
                <label key={mb.id} className="flex items-center gap-3 rounded-lg border border-border/40 p-3 cursor-pointer hover:bg-accent/50 transition-colors">
                  <input type="radio" name="activateTarget" value={mb.id} checked={activateTarget === mb.id} onChange={() => setActivateTarget(mb.id)} className="accent-primary" />
                  <div>
                    <p className="text-sm font-medium">{mb.accountType || mb.provider}</p>
                    <p className="text-xs text-muted-foreground">{mb.provider}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setActivateDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleActivateConfirm}>Activate</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={store.draftModalOpen} onOpenChange={store.setDraftModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Recovery Draft</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <textarea
              className="min-h-48 w-full rounded-lg border border-border bg-background p-3 text-sm"
              value={store.selectedLead?.followUpDraft || ""}
              readOnly
            />
            <div className="rounded-lg border border-border/40 p-3 text-sm">
              <p className="font-semibold">Recovery context</p>
              <p className="mt-1 text-muted-foreground">{store.selectedLead?.conversationSummary || "No context stored."}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Send from: {store.selectedLead?.sourceMailboxAccountType || store.selectedLead?.sourceMailboxProvider || store.selectedLead?.mailboxId || "source mailbox"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={sendingRecovery}
                onClick={async () => {
                  if (!store.selectedLead) return;
                  setSendingRecovery(true);
                  const pgLeadId = await store.sendRecovery(store.selectedLead.id);
                  setSendingRecovery(false);
                  if (pgLeadId) {
                    setLocation(`/dashboard/inbox/${pgLeadId}`);
                  }
                }}
              >
                {sendingRecovery ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sendingRecovery ? "Sending..." : "Send Recovery Email"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  store.setDraftModalOpen(false);
                  if (store.selectedLead?.id) {
                    setLocation(`/dashboard/inbox?recoveryDraft=${encodeURIComponent(store.selectedLead.followUpDraft || "")}&recoveryEmail=${encodeURIComponent(store.selectedLead.email)}`);
                  }
                }}
              >
                <ExternalLink className="mr-1 h-4 w-4" />
                Open in Inbox
              </Button>
            </div>
            {!!store.selectedLead?.brainstormedObjections?.length && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Brain className="h-4 w-4 text-primary" />
                  Objections Autonomously Found & Added by AI
                </h3>
                <div className="space-y-2">
                  {store.selectedLead.brainstormedObjections.map((objection, index) => (
                    <div key={`${objection.rule}-${index}`} className="text-sm">
                      <p className="font-semibold">{objection.category}</p>
                      <p className="text-muted-foreground">{objection.rule}</p>
                    </div>
                  ))}
                </div>
                <Button className="mt-4" size="sm" onClick={() => store.syncObjections([store.selectedLead!.id])}>
                  Sync objections
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function LeadRecoveryPage() {
  return (
    <LeadRecoveryProvider>
      <PageWrapper>
        <LeadRecoveryContent />
      </PageWrapper>
    </LeadRecoveryProvider>
  );
}
