import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useRealtime } from "@/hooks/use-realtime";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { useMailbox } from "@/hooks/use-mailbox";
import { MailboxSwitcher } from "@/components/outreach/MailboxSwitcher";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import {
  Shield, Mail, Clock, AlertTriangle, CheckCircle2, Thermometer,
  Loader2, Play, Plus, Search, ChevronDown, Activity,
  TrendingUp, BarChart3, Sparkles
} from "lucide-react";

interface MailboxWarmup {
  mailboxId: string;
  email: string;
  provider: string;
  isWarmingUp: boolean;
  dailyLimit: number;
  providerMax: number;
  daysSinceConnected: number;
  warmupPercent: number;
  reputationScore: number;
  totalSent: number;
  totalBounced: number;
  totalOpened: number;
  warmupStatus: string;
  warmupLimit: number;
}

const ITEMS_PER_PAGE = 20;

export default function WarmupPage() {
  const { socket } = useRealtime();
  const { mailboxes, selectedMailboxId } = useMailbox();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [warmupDays, setWarmupDays] = useState(1);

  useEffect(() => {
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/warmup-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warmup/activity"] });
    };
    socket.on("warmup_update", handler);
    socket.on("stats_updated", handler);
    return () => {
      socket.off("warmup_update", handler);
      socket.off("stats_updated", handler);
    };
  }, [socket, queryClient]);

  const { data: warmupData, isLoading, isError } = useQuery<any>({
    queryKey: ["/api/dashboard/warmup-status", selectedMailboxId],
    queryFn: async () => {
      const url = new URL("/api/dashboard/warmup-status", window.location.origin);
      if (selectedMailboxId) url.searchParams.set("integrationId", selectedMailboxId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch warmup status");
      return res.json();
    },
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    retry: 3,
    retryDelay: 1000,
  });

  const { data: activityData } = useQuery<any>({
    queryKey: ["/api/warmup/activity", selectedMailboxId, warmupDays],
    queryFn: async () => {
      const url = new URL("/api/warmup/activity", window.location.origin);
      if (selectedMailboxId) url.searchParams.set("mailboxId", selectedMailboxId);
      url.searchParams.set("days", String(warmupDays));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch warmup activity");
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const warmupStatuses: MailboxWarmup[] = warmupData?.mailboxes || [];
  const activityPeriods: { period: string; sends: number; opens: number; bounces: number }[] = activityData?.periods || [];
  const isHourly = activityData?.hourly ?? true;

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return warmupStatuses;
    const q = searchQuery.toLowerCase();
    return warmupStatuses.filter(m => m.email.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q));
  }, [warmupStatuses, searchQuery]);

  const pagedMailboxes = useMemo(() => {
    if (showAll) return filtered;
    return filtered.slice(0, (page + 1) * ITEMS_PER_PAGE);
  }, [filtered, page, showAll]);

  const activeMailboxes = warmupStatuses.filter(m => m.warmupStatus === 'active');
  const hasMailboxConnected = mailboxes.length > 0;

  const avgReputation = warmupStatuses.length > 0
    ? Math.round(warmupStatuses.reduce((s, m) => s + (m.reputationScore || 0), 0) / warmupStatuses.length)
    : null;
  const hasReputationData = warmupStatuses.some(m => m.totalSent > 0);

  const getStageLabel = (pct: number) => {
    if (pct <= 10) return "Day 1-2: Warming Up";
    if (pct <= 25) return "Day 3-5: Building Trust";
    if (pct <= 50) return "Day 6-10: Gaining Momentum";
    if (pct <= 75) return "Day 11-14: Almost There";
    return "Fully Warmed";
  };

  const getReputationColor = (score: number) => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 60) return "text-yellow-500";
    if (score >= 40) return "text-orange-500";
    return "text-red-500";
  };

  const toggleWarmupMutation = useMutation({
    mutationFn: async ({ mailboxIds, enabled }: { mailboxIds: string[]; enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/warmup/toggle", { mailboxIds, enabled });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/warmup-status"] });
      toast({ title: "Warmup Updated", description: "Mailbox warmup settings saved." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" })
  });

  const handleToggleAll = (enabled: boolean) => {
    const ids = warmupStatuses.map(m => m.mailboxId);
    toggleWarmupMutation.mutate({ mailboxIds: ids, enabled });
  };

  const handleToggleMailbox = (mailboxId: string, currentStatus: string) => {
    const enabled = currentStatus !== 'active';
    toggleWarmupMutation.mutate({ mailboxIds: [mailboxId], enabled });
  };

  // Compute warmup email count per mailbox
  const getWarmupEmailCount = (mb: MailboxWarmup) => {
    if (mb.warmupLimit > 0) return mb.warmupLimit;
    const pct = 0.10 + ((mb.mailboxId.charCodeAt(mb.mailboxId.length - 1) % 15) / 100);
    return Math.max(4, Math.min(15, Math.round(mb.dailyLimit * pct)));
  };

  if (!hasMailboxConnected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Email Warmup</h1>
            <p className="text-muted-foreground text-sm">Mailbox warmup and sender reputation</p>
          </div>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No mailboxes connected</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Connect a mailbox to start warming up your sender reputation.
            </p>
            <Link href="/dashboard/integrations">
              <Button className="rounded-xl gap-2">
                <Plus className="h-4 w-4" /> Connect Mailbox
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Email Warmup</h1>
          <p className="text-muted-foreground text-sm">
            Mailbox warmup and sender reputation
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MailboxSwitcher value={selectedMailboxId} onValueChange={setSelectedMailboxId} />
          <Badge variant={activeMailboxes.length > 0 ? "default" : "secondary"} className={cn("text-xs shrink-0", activeMailboxes.length > 0 && "bg-emerald-500/10 text-emerald-500 border-emerald-500/20")}>
            {activeMailboxes.length > 0
              ? `Warmup set (${activeMailboxes.length})`
              : warmupStatuses.length > 0 ? "Warmup paused" : "—"}
          </Badge>
          {warmupStatuses.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl gap-2"
              onClick={() => handleToggleAll(true)}
              disabled={toggleWarmupMutation.isPending}
            >
              <Play className="h-3.5 w-3.5" /> Start All
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-blue-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{warmupStatuses.length}</p>
                <p className="text-xs text-muted-foreground truncate">Total Mailboxes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{activeMailboxes.length}</p>
                <p className="text-xs text-muted-foreground truncate">Warming Up</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{warmupStatuses.filter(m => !m.isWarmingUp && m.warmupStatus === 'none').length}</p>
                <p className="text-xs text-muted-foreground truncate">Fully Warmed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                <Shield className="h-5 w-5 text-purple-500" />
              </div>
              <div className="min-w-0">
                <p className="text-2xl font-bold">{hasReputationData ? avgReputation : '--'}</p>
                <p className="text-xs text-muted-foreground truncate">Avg Reputation</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Warmup Activity Chart */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Warmup Activity
            </CardTitle>
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-0.5">
              {[1, 7, 14, 30, 90, 365].map(d => (
                <button
                  key={d}
                  onClick={() => setWarmupDays(d)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors",
                    warmupDays === d
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d === 1 ? '24H' : d === 365 ? '1Y' : `${d}D`}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {activityPeriods.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No warmup data in this period
            </div>
          ) : (
            <div className="w-full h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityPeriods} barCategoryGap={isHourly ? "20%" : "10%"}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: isHourly ? 10 : 8, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    interval={isHourly ? 2 : Math.max(0, Math.floor(activityPeriods.length / 10) - 1)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: number, name: string) => [
                      value, name.charAt(0).toUpperCase() + name.slice(1)
                    ]}
                    labelFormatter={(period: string) => isHourly ? `${period}:00` : period}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
                  />
                  <Bar dataKey="sends" name="Sends" fill="#3b82f6" radius={[3, 3, 0, 0]} maxBarSize={isHourly ? 16 : 32} />
                  <Bar dataKey="opens" name="Opens" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={isHourly ? 16 : 32} />
                  <Bar dataKey="bounces" name="Bounces" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={isHourly ? 16 : 32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Mailbox Warmup List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" />
              Mailbox Warmup Settings
            </CardTitle>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  placeholder="Search mailboxes..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
                  className="h-8 w-full sm:w-48 rounded-lg border border-border/50 bg-background pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-primary/20"
                />
              </div>
              {warmupStatuses.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-lg h-8 text-xs gap-1"
                  onClick={() => handleToggleAll(true)}
                  disabled={toggleWarmupMutation.isPending}
                >
                  <Play className="h-3 w-3" /> Start All
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />
              Loading mailboxes...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No mailboxes found</p>
            </div>
          ) : (
            <>
              {/* Header Row */}
              <div className="hidden md:grid grid-cols-[1fr_100px_100px_80px_80px_70px] gap-3 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                <span>Mailbox</span>
                <span className="text-center">Warmup/Day</span>
                <span className="text-center">Daily Limit</span>
                <span className="text-center">Rep</span>
                <span className="text-center">Progress</span>
                <span className="text-center">Status</span>
              </div>

              {pagedMailboxes.map((mb) => {
                const warmupEnabled = mb.warmupStatus === 'active';
                const warmupCount = getWarmupEmailCount(mb);
                return (
                  <div
                    key={mb.mailboxId}
                    className={cn(
                      "grid grid-cols-[1fr_auto] md:grid-cols-[1fr_100px_100px_80px_80px_70px] gap-3 items-center px-3 py-2.5 rounded-xl transition-colors",
                      warmupEnabled ? "bg-primary/5 border border-primary/10" : "hover:bg-muted/20 border border-transparent"
                    )}
                  >
                    {/* Mailbox Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={warmupEnabled}
                          onCheckedChange={() => handleToggleMailbox(mb.mailboxId, mb.warmupStatus)}
                          disabled={toggleWarmupMutation.isPending}
                          className="scale-75 origin-left shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{mb.email}</p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {mb.provider} • {mb.daysSinceConnected}d connected
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Warmup/Day */}
                    <div className="text-center hidden md:block">
                      <p className="text-sm font-bold">{warmupCount}</p>
                      <p className="text-[9px] text-muted-foreground">emails</p>
                    </div>

                    {/* Daily Limit */}
                    <div className="text-center hidden md:block">
                      <p className="text-sm font-medium">{mb.dailyLimit}</p>
                      <p className="text-[9px] text-muted-foreground">{mb.providerMax} max</p>
                    </div>

                    {/* Reputation */}
                    <div className="text-center hidden md:block">
                      <p className={cn("text-sm font-bold", mb.totalSent > 0 ? getReputationColor(mb.reputationScore) : "text-muted-foreground")}>
                        {mb.totalSent > 0 ? mb.reputationScore : '--'}
                      </p>
                      <div className="flex items-center justify-center gap-0.5">
                        <Thermometer className={cn("h-2.5 w-2.5", getReputationColor(mb.reputationScore))} />
                        <span className="text-[9px] text-muted-foreground">/100</span>
                      </div>
                    </div>

                    {/* Progress */}
                    <div className="text-center hidden md:block">
                      <p className="text-sm font-bold">{mb.warmupPercent}%</p>
                      <Progress value={mb.warmupPercent} className="h-1 mt-1" />
                    </div>

                    {/* Status toggle (desktop) */}
                    <div className="text-center hidden md:block">
                      <Badge
                        variant={warmupEnabled ? "default" : "secondary"}
                        className={cn(
                          "text-[9px] font-medium cursor-pointer",
                          warmupEnabled && "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        )}
                        onClick={() => handleToggleMailbox(mb.mailboxId, mb.warmupStatus)}
                      >
                        {warmupEnabled ? "Active" : mb.warmupStatus === 'paused' ? "Paused" : "Off"}
                      </Badge>
                    </div>

                    {/* Mobile: warmup count + badge row */}
                    <div className="flex items-center gap-2 md:hidden">
                      <div className="text-right">
                        <p className="text-xs font-bold">{warmupCount}/d</p>
                      </div>
                      <Badge
                        variant={warmupEnabled ? "default" : "secondary"}
                        className={cn(
                          "text-[9px] font-medium",
                          warmupEnabled && "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                        )}
                      >
                        {warmupEnabled ? "Active" : mb.warmupStatus === 'paused' ? "Paused" : "Off"}
                      </Badge>
                    </div>
                  </div>
                );
              })}

              {/* Load More */}
              {!showAll && filtered.length > (page + 1) * ITEMS_PER_PAGE && (
                <div className="pt-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-xs gap-2 h-8"
                    onClick={() => setPage(p => p + 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    Load More ({filtered.length - (page + 1) * ITEMS_PER_PAGE} remaining)
                  </Button>
                </div>
              )}

              {!showAll && filtered.length > ITEMS_PER_PAGE && filtered.length <= (page + 1) * ITEMS_PER_PAGE && (
                <div className="pt-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-xs gap-2 h-8"
                    onClick={() => setShowAll(true)}
                  >
                    Show All ({filtered.length} mailboxes)
                  </Button>
                </div>
              )}

              {/* Footer info */}
              <div className="pt-4 border-t border-border/40 mt-4">
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                  Warmup sends {activeMailboxes.length > 0 ? 'active' : 'no'} — warmup emails build reputation without counting toward your daily sending limit.
                  {activeMailboxes.length > 0 && ` ${activeMailboxes.length} mailbox(es) warming up with a total of ${activeMailboxes.reduce((s, m) => s + getWarmupEmailCount(m), 0)} warmup emails/day.`}
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Active Warmup Details */}
      {activeMailboxes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-amber-500" />
              Active Warmup Progress
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeMailboxes.map((mb) => (
              <div key={mb.mailboxId} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{mb.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {mb.provider} • {getWarmupEmailCount(mb)} warmup/day • {mb.dailyLimit} outreach/day
                    </p>
                  </div>
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30 shrink-0 ml-2">
                    {mb.warmupPercent}% warmed
                  </Badge>
                </div>
                <Progress value={mb.warmupPercent} className="h-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{getStageLabel(mb.warmupPercent)}</span>
                  <span>{mb.totalSent} sent • {mb.totalOpened} opened</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold">{mb.totalSent}</p>
                    <p className="text-[10px] text-muted-foreground">Sent</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold">{mb.totalOpened}</p>
                    <p className="text-[10px] text-muted-foreground">Opened</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold text-red-500">{mb.totalBounced}</p>
                    <p className="text-[10px] text-muted-foreground">Bounced</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold" style={{ color: mb.reputationScore >= 80 ? '#10b981' : mb.reputationScore >= 60 ? '#eab308' : mb.reputationScore >= 40 ? '#f97316' : '#ef4444' }}>
                      {mb.reputationScore}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Reputation</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Completed Mailboxes */}
      {warmupStatuses.filter(m => m.warmupStatus !== 'active' && m.warmupPercent >= 100).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Fully Warmed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {warmupStatuses.filter(m => m.warmupPercent >= 100).map((mb) => (
                <div key={mb.mailboxId} className="border rounded-lg p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{mb.email}</p>
                    <p className="text-xs text-muted-foreground">{mb.provider} • {mb.totalSent} emails sent</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <Badge variant="secondary" className="text-emerald-500">{mb.dailyLimit}/day</Badge>
                    <p className={cn("text-xs mt-1", getReputationColor(mb.reputationScore))}>
                      Rep: {mb.reputationScore}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* No warmup data yet */}
      {warmupStatuses.length === 0 && !isLoading && hasMailboxConnected && (
        <Card>
          <CardContent className="p-12 text-center">
            <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">Ready to Start Warming</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Your mailbox is connected. Enable warmup above to build sender reputation automatically.
              Warmup runs independently from your campaign sending schedule.
            </p>
            <Button
              className="rounded-xl gap-2"
              onClick={() => handleToggleAll(true)}
              disabled={toggleWarmupMutation.isPending}
            >
              {toggleWarmupMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start Warmup on All Mailboxes
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
