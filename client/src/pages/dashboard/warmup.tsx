import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRealtime } from "@/hooks/use-realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, Mail, Clock, AlertTriangle, CheckCircle2, Thermometer } from "lucide-react";
import { useMailbox } from "@/hooks/use-mailbox";
import { Link } from "wouter";

interface WarmupStatus {
  mailboxId: string;
  email: string;
  provider: string;
  isWarmingUp: boolean;
  dailyLimit: number;
  providerMax: number;
  daysSinceConnected: number;
  warmupPercent: number;
  stage: string;
  reputationScore: number;
  totalSent: number;
  totalBounced: number;
  totalOpened: number;
}

export default function WarmupPage() {
  const { socket } = useRealtime();
  const { mailboxes, selectedMailboxId } = useMailbox();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!socket) return;
    const handler = () => queryClient.invalidateQueries({ queryKey: ["/api/warmup/status"] });
    socket.on("warmup_update", handler);
    socket.on("mailbox_updated", handler);
    return () => { socket.off("warmup_update", handler); socket.off("mailbox_updated", handler); };
  }, [socket, queryClient]);

  const { data: warmupData, isLoading } = useQuery<any>({
    queryKey: ["/api/warmup/status", { integrationId: selectedMailboxId }],
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });

  const warmupStatuses: WarmupStatus[] = warmupData?.mailboxes || [];

  const activeWarmups = warmupStatuses.filter((w) => w.isWarmingUp);
  const completedWarmups = warmupStatuses.filter((w) => !w.isWarmingUp);

  const hasWarmupData = warmupStatuses.length > 0;
  const hasMailboxConnected = mailboxes.length > 0;

  const getStageLabel = (percent: number): string => {
    if (percent <= 10) return "Day 1-2: Warming Up";
    if (percent <= 25) return "Day 3-5: Building Trust";
    if (percent <= 50) return "Day 6-10: Gaining Momentum";
    if (percent <= 75) return "Day 11-14: Almost There";
    return "Day 15+: Fully Warmed";
  };

  const getReputationColor = (score: number): string => {
    if (score >= 80) return "text-emerald-500";
    if (score >= 60) return "text-yellow-500";
    if (score >= 40) return "text-orange-500";
    return "text-red-500";
  };

  const avgReputation = warmupStatuses.length > 0
    ? Math.round(warmupStatuses.reduce((sum, w) => sum + w.reputationScore, 0) / warmupStatuses.length)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Email Warmup</h1>
          <p className="text-muted-foreground text-sm">
            Mailbox warmup and sender reputation
          </p>
        </div>
        <Badge variant={activeWarmups.length > 0 ? "default" : "secondary"}>
          {activeWarmups.length > 0
            ? `${activeWarmups.length} warming`
            : hasWarmupData ? "All warmed" : "—"}
        </Badge>
      </div>

      {/* Summary Cards — always visible */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Mail className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{hasMailboxConnected ? mailboxes.length : 0}</p>
                <p className="text-xs text-muted-foreground">Total Mailboxes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{activeWarmups.length}</p>
                <p className="text-xs text-muted-foreground">Warming Up</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{completedWarmups.length}</p>
                <p className="text-xs text-muted-foreground">Fully Warmed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{avgReputation}</p>
                <p className="text-xs text-muted-foreground">Avg Reputation</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Warmups */}
      {activeWarmups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              Active Warmups
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeWarmups.map((w) => (
              <div key={w.mailboxId} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{w.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.provider} • Connected {w.daysSinceConnected} days ago
                    </p>
                  </div>
                  <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                    {w.warmupPercent}% warmed
                  </Badge>
                </div>
                <Progress value={w.warmupPercent} className="h-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{getStageLabel(w.warmupPercent)}</span>
                  <span>
                    Sending {w.dailyLimit}/{w.providerMax} emails/day
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold">{w.totalSent}</p>
                    <p className="text-[10px] text-muted-foreground">Sent</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold">{w.totalOpened}</p>
                    <p className="text-[10px] text-muted-foreground">Opened</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold text-red-500">{w.totalBounced}</p>
                    <p className="text-[10px] text-muted-foreground">Bounced</p>
                  </div>
                  <div className="bg-muted/30 rounded p-2">
                    <p className="text-lg font-bold" style={{ color: w.reputationScore >= 60 ? '#10b981' : w.reputationScore >= 40 ? '#f59e0b' : '#ef4444' }}>
                      {w.reputationScore}
                    </p>
                    <p className="text-[10px] text-muted-foreground">Reputation</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Thermometer className={`h-3 w-3 ${getReputationColor(w.reputationScore)}`} />
                  <span className={`text-xs font-medium ${getReputationColor(w.reputationScore)}`}>
                    Reputation: {w.reputationScore}/100
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Completed Warmups */}
      {completedWarmups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Fully Warmed Mailboxes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {completedWarmups.map((w) => (
                <div key={w.mailboxId} className="border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{w.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.provider} • {w.totalSent} emails sent
                    </p>
                  </div>
                  <div className="text-right">
                    <Badge variant="secondary" className="text-emerald-500">
                      {w.dailyLimit}/day
                    </Badge>
                    <p className={`text-xs mt-1 ${getReputationColor(w.reputationScore)}`}>
                      Rep: {w.reputationScore}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state — only shown when no warmup data at all */}
      {!hasWarmupData && !isLoading && (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            {hasMailboxConnected ? (
              <>
                <h3 className="text-lg font-medium mb-2">Warmup not started</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Mailbox connected but warmup hasn't started yet. It will begin automatically.
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Once started, you'll see real-time stats for emails sent, opened, bounced, and your reputation score.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-medium mb-2">No mailboxes connected</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Connect a mailbox to start warming up your sender reputation.
                </p>
                <Link href="/dashboard/integrations" className="inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                  Connect Mailbox
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
