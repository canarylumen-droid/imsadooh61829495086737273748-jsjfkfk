import { useEffect } from "react";
import { AlertTriangle, Brain, CheckCircle2, Clock, Mail, RefreshCw, ShieldCheck, Sparkles, DownloadCloud } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { LeadRecoveryProvider, useLeadRecoveryStore, type RecoveredLead } from "@/stores/leadRecoveryStore";

function intentTone(intent: RecoveredLead["intent"]) {
  if (intent === "Converted") return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20";
  if (intent === "Reply-Needed") return "bg-primary/10 text-primary border-primary/20";
  if (intent === "Not-Interested") return "bg-red-500/10 text-red-500 border-red-500/20";
  return "bg-amber-500/10 text-amber-500 border-amber-500/20";
}

function LeadRecoveryContent() {
  const store = useLeadRecoveryStore();

  useEffect(() => {
    store.loadAll().catch(() => undefined);
  }, []);

  const syncingMailboxes = store.mailboxDetails.filter((mailbox) => mailbox.syncStatus === "queued" || mailbox.syncStatus === "syncing").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Lead Recovery</h1>
              <p className="text-sm text-muted-foreground">Email-only recovery for inactive prospects and missed replies.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/70 px-4 py-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recovery</p>
            <p className="text-sm font-semibold">{store.isActive ? "Active" : "Inactive"}</p>
          </div>
          <Switch
            checked={store.isActive}
            disabled={store.loading}
            onCheckedChange={(checked) => checked ? store.activate() : store.deactivate()}
          />
        </div>
      </div>

      {!store.hasAvailableMailbox && !store.isActive && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
          <div className="mb-1 flex items-center gap-2 font-bold text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Mailboxes are currently busy
          </div>
          Lead Recovery sync is read-only and can still scan history. Recovery sending should wait until campaign mailboxes are free.
          {store.availableAt && <span className="ml-1">Estimated availability: {new Date(store.availableAt).toLocaleString()}.</span>}
        </div>
      )}

      {!store.promptConfigured && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="mb-1 flex items-center gap-2 font-bold text-red-300">
            <AlertTriangle className="h-4 w-4" />
            Recovery prompt is not configured
          </div>
          Add `LEAD_RECOVERY_SYSTEM_PROMPT` and `LEAD_RECOVERY_USER_PROMPT_TEMPLATE`, or save a Mongo prompt config named `email-lead-recovery`.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border/40 bg-card/70 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Recoverable Leads</p>
          <p className="mt-2 text-3xl font-black">{store.leads.length}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/70 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Synced Mailboxes</p>
          <p className="mt-2 text-3xl font-black">{store.mailboxDetails.filter((mailbox) => mailbox.lastSyncAt).length}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/70 p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Audit Events</p>
          <p className="mt-2 text-3xl font-black">{store.events.length}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-border/40 bg-card/70">
          <div className="flex items-center justify-between border-b border-border/30 p-4">
            <div>
              <h2 className="font-black">Recoverable Leads</h2>
              <p className="text-xs text-muted-foreground">Stored in MongoDB per tenant, mailbox, and lead conversation.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={store.loadAll} disabled={store.loading}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
              <Button size="sm" onClick={() => store.syncNow()} disabled={store.loading || store.mailboxDetails.length === 0}>
                <DownloadCloud className="mr-2 h-4 w-4" />
                {syncingMailboxes > 0 ? `Syncing ${syncingMailboxes}` : "Sync 90 days"}
              </Button>
            </div>
          </div>
          <div className="divide-y divide-border/30">
            {store.leads.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No recovered leads yet. Activate Lead Recovery, then click Sync 90 days to scan connected mailboxes.
              </div>
            ) : store.leads.map((lead) => (
              <div key={lead._id} className="grid gap-4 p-4 md:grid-cols-[1fr_160px_160px_auto] md:items-center">
                <div className="min-w-0">
                  <p className="truncate font-bold">{lead.email}</p>
                  <p className="truncate text-sm text-muted-foreground">{lead.subject || "No subject"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Source: {lead.sourceMailboxSnapshot?.accountType || lead.sourceMailboxSnapshot?.provider || lead.mailboxId || "mailbox"}
                  </p>
                  {!!lead.brainstormedObjections?.length && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-primary">
                      <Brain className="h-3.5 w-3.5" />
                      {lead.brainstormedObjections.length} objection{lead.brainstormedObjections.length === 1 ? "" : "s"} found
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={intentTone(lead.intent)}>{lead.intent}</Badge>
                <Badge variant="outline" className="capitalize">{lead.deliverabilityStatus}</Badge>
                <Button size="sm" onClick={() => store.recoverLead(lead._id)}>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Recover
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-border/40 bg-card/70 p-4">
            <h2 className="mb-3 font-black">Mailbox Status</h2>
            <div className="space-y-3">
              {store.mailboxDetails.map((mailbox) => (
                <div key={mailbox.id} className="rounded-lg border border-border/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold">{mailbox.accountType || mailbox.provider}</p>
                      <p className="text-xs text-muted-foreground">{mailbox.provider}</p>
                    </div>
                    {mailbox.isBusy ? <Clock className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  </div>
                  {mailbox.availableAt && <p className="mt-2 text-xs text-muted-foreground">Available {new Date(mailbox.availableAt).toLocaleString()}</p>}
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px] capitalize">{mailbox.syncStatus || "idle"}</Badge>
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
              <h2 className="font-black">Audit Log</h2>
            </div>
            <ScrollArea className="h-[320px] pr-3">
              <div className="space-y-3">
                {store.events.map((event) => (
                  <div key={event._id} className="rounded-lg border border-border/30 p-3">
                    <p className="text-sm font-bold">{event.action}</p>
                    <p className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>

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
              <p className="font-bold">Recovery context</p>
              <p className="mt-1 text-muted-foreground">{store.selectedLead?.conversationSummary || "No context stored."}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Send from: {store.selectedLead?.sourceMailboxSnapshot?.accountType || store.selectedLead?.sourceMailboxSnapshot?.provider || store.selectedLead?.mailboxId || "source mailbox"}
              </p>
            </div>
            {!!store.selectedLead?.brainstormedObjections?.length && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-black">
                  <Brain className="h-4 w-4 text-primary" />
                  Objections Autonomously Found & Added by AI
                </h3>
                <div className="space-y-2">
                  {store.selectedLead.brainstormedObjections.map((objection, index) => (
                    <div key={`${objection.rule}-${index}`} className="text-sm">
                      <p className="font-bold">{objection.category}</p>
                      <p className="text-muted-foreground">{objection.rule}</p>
                    </div>
                  ))}
                </div>
                <Button className="mt-4" size="sm" onClick={() => store.syncObjections([store.selectedLead!._id])}>
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
      <LeadRecoveryContent />
    </LeadRecoveryProvider>
  );
}
