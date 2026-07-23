import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtime } from "@/hooks/use-realtime";
import { useMailbox } from "@/hooks/use-mailbox";
import { PageWrapper } from '@/components/ui/page-wrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RefreshCw, Plus, Shield, AlertTriangle, CheckCircle2, Activity, Mail, Target, Loader2, Edit3, Check, X } from 'lucide-react';
import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface PlacementMailbox {
  integrationId: string;
  sent: number;
  inbox: number;
  spam: number;
  bounce: number;
  other: number;
  inboxRate: number;
}

interface InboxPlacementData {
  totals: { sent: number; inbox: number; spam: number; bounce: number; rate: string };
  mailboxes: PlacementMailbox[];
}

export default function DeliverabilityPage() {
  const { socket } = useRealtime();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { selectedMailboxId } = useMailbox();

  useEffect(() => {
    if (!socket) return;
    const inboxHandler = () => queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] });
    const warmupHandler = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/warmup-status"] });
    };
    socket.on("leads_updated", inboxHandler);
    socket.on("warmup_update", warmupHandler);
    socket.on("stats_updated", inboxHandler);
    socket.on("deliverability_updated", inboxHandler);
    socket.on("integration_reputation_updated", inboxHandler);
    return () => {
      socket.off("leads_updated", inboxHandler);
      socket.off("warmup_update", warmupHandler);
      socket.off("stats_updated", inboxHandler);
      socket.off("deliverability_updated", inboxHandler);
      socket.off("integration_reputation_updated", inboxHandler);
    };
  }, [socket, queryClient]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [placementDays, setPlacementDays] = useState(30);

  const { data: integrationsData, isLoading, refetch } = useQuery({
    queryKey: ['/api/integrations'],
    select: (d: any) => (d.integrations || d || []).filter((i: any) => ['gmail', 'outlook', 'custom_email'].includes(i.provider)),
  });

  const { data: placementData } = useQuery<InboxPlacementData>({
    queryKey: ["/api/stats/inbox-placement", { days: placementDays, integrationId: selectedMailboxId }],
    queryFn: async () => {
      const url = new URL("/api/stats/inbox-placement", window.location.origin);
      url.searchParams.set("days", String(placementDays));
      if (selectedMailboxId) url.searchParams.set("integrationId", selectedMailboxId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch inbox placement");
      return res.json();
    },
  });

  const mailboxes: any[] = integrationsData || [];
  const placementByIntegrationId = useMemo(() => {
    const map: Record<string, PlacementMailbox> = {};
    if (placementData?.mailboxes) {
      for (const mb of placementData.mailboxes) {
        map[mb.integrationId] = mb;
      }
    }
    return map;
  }, [placementData]);

  const enrichedMailboxes = useMemo(() => mailboxes.map(mb => {
    const placement = placementByIntegrationId[mb.id];
    return {
      ...mb,
      _realSpamCount: placement?.spam ?? 0,
      _realBounceCount: placement?.bounce ?? 0,
      _realSentCount: placement?.sent ?? 0,
      _realInboxCount: placement?.inbox ?? 0,
      _realInboxRate: placement?.inboxRate ?? 0,
      _hasRealData: (placement?.sent ?? 0) > 0,
    };
  }), [mailboxes, placementByIntegrationId]);

  const hasRealData = enrichedMailboxes.some(m => m._hasRealData);

  const mailboxesWithRep = mailboxes.filter((m: any) => m.reputationScore !== undefined && m.reputationScore !== null);
  const avgScore = mailboxesWithRep.length > 0
    ? Number((mailboxesWithRep.reduce((s: number, m: any) => s + m.reputationScore, 0) / mailboxesWithRep.length).toFixed(2))
    : null;
  const healthyCount = mailboxesWithRep.filter((m: any) => m.reputationScore >= 70).length;
  const atRiskCount = mailboxesWithRep.filter((m: any) => m.reputationScore < 70 && m.reputationScore >= 40).length;
  const criticalCount = mailboxesWithRep.filter((m: any) => m.reputationScore < 40).length;

  const [editingLimit, setEditingLimit] = useState<{ id: string; value: string } | null>(null);
  const updateLimitMutation = useMutation({
    mutationFn: async ({ integrationId, limit }: { integrationId: string; limit: number }) => {
      await apiRequest("PATCH", `/api/integrations/${integrationId}/outreach-limit`, { initialOutreachLimit: limit });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] });
      toast({ title: "Daily limit updated" });
      setEditingLimit(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to update limit", description: err.message, variant: "destructive" });
    }
  });

  const totalBounces = enrichedMailboxes.reduce((s: number, m: any) => s + (m._realBounceCount ?? 0), 0);
  const totalSpam = enrichedMailboxes.reduce((s: number, m: any) => s + (m._realSpamCount ?? 0), 0);
  const totalSent = enrichedMailboxes.reduce((s: number, m: any) => s + (m._realSentCount ?? 0), 0);
  const globalBounceRate = totalSent > 0 && hasRealData ? ((totalBounces / totalSent) * 100).toFixed(1) : null;
  const globalSpamRate = totalSent > 0 && hasRealData ? ((totalSpam / totalSent) * 100).toFixed(1) : null;

  return (
    <PageWrapper className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Deliverability & Reputation</h1>
            <p className="text-sm text-muted-foreground">Per-mailbox spam score, blacklist status, DNS health, and bounce monitoring. Real-time via socket events.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={async () => { setIsRefreshing(true); await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["/api/stats/inbox-placement"] })]); setIsRefreshing(false); }} disabled={isRefreshing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} /> {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-24 rounded-xl bg-muted/30 animate-pulse" />)}
        </div>
      ) : mailboxes.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-16 text-center">
            <Shield className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Mailboxes Connected</h3>
            <p className="text-sm text-muted-foreground mb-4">Connect Gmail, Outlook, or custom SMTP to monitor deliverability.</p>
            <Button onClick={() => navigate('/dashboard/integrations')}><Plus className="h-4 w-4 mr-2" />Connect Mailbox</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {!hasRealData ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center py-12 text-center">
                <Activity className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <h3 className="text-base font-semibold mb-1">{selectedMailboxId ? 'No Data for This Mailbox' : 'Awaiting Delivery Data'}</h3>
                <p className="text-sm text-muted-foreground max-w-sm">{selectedMailboxId ? 'This mailbox has no tracked email activity yet. Send emails to see placement data.' : 'Send emails to see placement breakdown, bounce rate, and spam score. Data updates in real-time.'}</p>
              </CardContent>
            </Card>
          ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="bg-card/50 border-border/40">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Average Reputation</p>
                {avgScore !== null ? (
                  <p className={cn("text-2xl font-black", avgScore >= 70 ? "text-emerald-500" : avgScore >= 40 ? "text-amber-500" : "text-red-500")}>
                    {avgScore.toFixed(2)}
                    <span className="text-sm font-medium text-muted-foreground/60 ml-1">/100</span>
                  </p>
                ) : (
                  <p className="text-2xl font-black text-muted-foreground/40">—</p>
                )}
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/40">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Healthy</p>
                <p className="text-2xl font-black text-emerald-500">{healthyCount} <span className="text-sm font-medium text-muted-foreground/60">mailboxes</span></p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/40">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">At Risk</p>
                <p className="text-2xl font-black text-amber-500">{atRiskCount} <span className="text-sm font-medium text-muted-foreground/60">mailboxes</span></p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/40">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Critical</p>
                <p className="text-2xl font-black text-red-500">{criticalCount} <span className="text-sm font-medium text-muted-foreground/60">mailboxes</span></p>
              </CardContent>
            </Card>
            {globalBounceRate !== null && (
              <Card className="bg-card/50 border-border/40">
                <CardContent className="p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Bounce Rate</p>
                  <p className={cn("text-2xl font-black", parseFloat(globalBounceRate) > 5 ? "text-red-500" : parseFloat(globalBounceRate) > 2 ? "text-amber-500" : "text-emerald-500")}>
                    {globalBounceRate}%
                  </p>
                </CardContent>
              </Card>
            )}
            {globalSpamRate !== null && (
              <Card className="bg-card/50 border-border/40">
                <CardContent className="p-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Spam Rate</p>
                  <p className={cn("text-2xl font-black", parseFloat(globalSpamRate) > 5 ? "text-red-500" : parseFloat(globalSpamRate) > 2 ? "text-amber-500" : "text-emerald-500")}>
                    {globalSpamRate}%
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
          )}

          <InboxPlacementPie selectedMailboxId={selectedMailboxId} />

          <div className="space-y-3">
            {enrichedMailboxes.map((mb: any, i: number) => {
              const score = mb.reputationScore ?? 0;
              const scoreColor = score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-red-500";
              const scoreBg = score >= 70 ? "bg-emerald-500/10 border-emerald-500/20" : score >= 40 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";
              const healthLabel = score >= 70 ? "Healthy" : score >= 40 ? "At Risk" : "Critical";
              const dailyLimit = mb.initialOutreachLimit ?? mb.dailyLimit ?? 35;
              const spamCount = mb._realSpamCount;
              const bounceCount = mb._realBounceCount;
              const sentCount = mb._realSentCount;
              const inboxRate = mb._realInboxRate;

              return (
                <motion.div key={mb.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                  <Card className={cn("border-l-4", score >= 70 ? "border-l-emerald-500" : score >= 40 ? "border-l-amber-500" : "border-l-red-500")}>
                    <CardContent className="p-4">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="font-semibold text-sm truncate">{mb.email || mb.accountType || 'Unknown'}</p>
                            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{mb.provider === 'custom_email' ? 'SMTP' : mb.provider}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          {mb.reputationScore !== undefined && mb.reputationScore !== null ? (
                            <div className={cn("px-3 py-1 rounded-full border text-xs font-bold", scoreBg, scoreColor)}>
                              {score.toFixed(2)}/100
                            </div>
                          ) : (
                            <div className="px-3 py-1 rounded-full border text-xs font-bold text-muted-foreground/40 border-border/40">
                              —/100
                            </div>
                          )}
                          <Badge variant="outline" className={cn(
                            "text-[9px] uppercase font-black tracking-wider",
                            healthLabel === "Healthy" ? "text-emerald-500 border-emerald-500/30" :
                            healthLabel === "At Risk" ? "text-amber-500 border-amber-500/30" :
                            "text-red-500 border-red-500/30"
                          )}>
                            {healthLabel === "Healthy" ? <CheckCircle2 className="w-3 h-3 mr-1" /> :
                             healthLabel === "At Risk" ? <Activity className="w-3 h-3 mr-1" /> :
                             <AlertTriangle className="w-3 h-3 mr-1" />}
                            {healthLabel}
                          </Badge>
                          {editingLimit?.id === mb.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={1}
                                max={250}
                                value={editingLimit.value}
                                onChange={(e) => setEditingLimit({ id: mb.id, value: e.target.value })}
                                className="h-7 w-16 text-xs px-2"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const val = parseInt(editingLimit.value);
                                    if (val >= 1 && val <= 250) updateLimitMutation.mutate({ integrationId: mb.id, limit: val });
                                  }
                                  if (e.key === 'Escape') setEditingLimit(null);
                                }}
                                autoFocus
                              />
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-emerald-500" onClick={() => { const val = parseInt(editingLimit.value); if (val >= 1 && val <= 250) updateLimitMutation.mutate({ integrationId: mb.id, limit: val }); }} disabled={updateLimitMutation.isPending}>
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={() => setEditingLimit(null)}>
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-6 text-[10px] font-bold gap-1 px-2 text-muted-foreground hover:text-foreground" onClick={() => setEditingLimit({ id: mb.id, value: String(dailyLimit) })}>
                              <Edit3 className="h-2.5 w-2.5" /> {dailyLimit}/day
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-3 border-t border-border/20">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Sent</p>
                          <p className="text-sm font-bold">{sentCount}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Inbox Rate</p>
                          <p className={cn("text-sm font-bold", inboxRate >= 90 ? "text-emerald-500" : inboxRate >= 50 ? "text-amber-500" : "text-red-500")}>
                             {mb._hasRealData ? `${inboxRate}%` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Bounce Rate</p>
                          <p className={cn("text-sm font-bold", sentCount > 0 ? (bounceCount / sentCount) * 100 > 5 ? "text-red-500" : (bounceCount / sentCount) * 100 > 2 ? "text-amber-500" : "text-emerald-500" : "")}>
                            {sentCount > 0 ? `${((bounceCount / sentCount) * 100).toFixed(1)}%` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Spam Rate</p>
                          <p className={cn("text-sm font-bold", sentCount > 0 ? (spamCount / sentCount) * 100 > 5 ? "text-red-500" : (spamCount / sentCount) * 100 > 2 ? "text-amber-500" : "text-emerald-500" : "")}>
                            {sentCount > 0 ? `${((spamCount / sentCount) * 100).toFixed(1)}%` : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">DNS</p>
                          <p className="text-sm font-bold">
                            {(mb as any).dnsValid === true ? (
                              <Badge variant="outline" className="text-[9px] bg-emerald-500/10 text-emerald-500">Valid</Badge>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </PageWrapper>
  );
}

function InboxPlacementPie({ selectedMailboxId }: { selectedMailboxId?: string }) {
  const [pieDays, setPieDays] = useState<1 | 7 | 30 | 60 | 90>(30);
  const { data } = useQuery<InboxPlacementData>({
    queryKey: ["/api/stats/inbox-placement", { days: pieDays, integrationId: selectedMailboxId }],
    queryFn: async () => {
      const url = new URL("/api/stats/inbox-placement", window.location.origin);
      url.searchParams.set("days", String(pieDays));
      if (selectedMailboxId) url.searchParams.set("integrationId", selectedMailboxId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch inbox placement");
      return res.json();
    },
  });

  const { totals } = data || { totals: { sent: 0, inbox: 0, spam: 0, bounce: 0, rate: '0%' } };

  const pending = totals.sent - totals.inbox - totals.spam - totals.bounce;

  const pieData = [
    { name: 'Inbox', value: totals.inbox, color: '#10b981' },
    { name: 'Pending', value: pending, color: '#6b7280' },
    { name: 'Spam', value: totals.spam, color: '#ef4444' },
    { name: 'Bounce', value: totals.bounce, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const hasRealPlacement = totals.inbox > 0 || totals.spam > 0 || totals.bounce > 0;

  const dayLabel = pieDays === 1 ? '24h' : `${pieDays}d`;

  const hasData = totals.sent > 0;

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card className="bg-card/50 border-border/40">
        <CardHeader className="p-3 pb-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-emerald-500" /> Inbox Placement ({dayLabel})
            </CardTitle>
            <div className="flex bg-muted/50 rounded-lg p-0.5">
              {([1, 7, 30, 60, 90] as const).map(d => (
                <Button key={d} variant="ghost" size="sm" onClick={() => setPieDays(d)}
                  className={cn("h-5 text-[8px] font-bold px-1.5", pieDays === d && "bg-background shadow-sm")}>
                  {d === 1 ? '24h' : `${d}d`}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-[180px] flex items-center justify-center">
          {hasData ? (
            <div className="w-full flex items-center gap-3 px-2">
              <ChartContainer config={{}} className="w-[45%] h-full aspect-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={25} outerRadius={50} paddingAngle={3}>
                      {pieData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartContainer>
              <div className="space-y-3">
                {pieData.map(entry => {
                  const pct = totals.sent > 0 ? ((entry.value / totals.sent) * 100).toFixed(0) : '0';
                  return (
                    <div key={entry.name} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-12">{entry.name}</span>
                      <span className="text-xs font-bold tabular-nums">{entry.value}</span>
                      <span className="text-[10px] text-muted-foreground/60">({pct}%)</span>
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-12">Total</span>
                  <span className="text-xs font-bold tabular-nums">{totals.sent}</span>
                  {hasRealPlacement && (
                    <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30 bg-emerald-500/5 ml-auto">
                      {totals.rate} inbox
                    </Badge>
                  )}
                  {!hasRealPlacement && pending > 0 && (
                    <span className="text-[9px] text-muted-foreground/60 ml-auto">awaiting opens/placement</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-xs text-muted-foreground">No emails tracked this period.</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Send emails to see placement breakdown.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
