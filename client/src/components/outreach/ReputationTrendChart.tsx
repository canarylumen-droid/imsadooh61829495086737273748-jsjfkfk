import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRealtime } from "@/hooks/use-realtime";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  Mail,
  Clock,
  Target,
  Gauge,
} from "lucide-react";

interface ProviderBreakdown {
  provider: string;
  inbox: number;
  spam: number;
  total: number;
  rate: number;
}

interface SeedPlacementData {
  success: boolean;
  seedsConfigured: boolean;
  hasSeeds: boolean;
  seedScore: number;
  postmasterSpamRate: number | null;
  postmasterScore: number | null;
  finalScore: number | null;
  providerBreakdown: ProviderBreakdown[];
  lastTestedAt: string | null;
  campaignId: string | null;
}

export const ReputationTrendChart = () => {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();

  const { data, isLoading, refetch } = useQuery<SeedPlacementData>({
    queryKey: ['/api/stats/seed-placement'],
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!socket) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['/api/stats/seed-placement'] });
    };
    socket.on('deliverability_updated', handler);
    return () => { socket.off('deliverability_updated', handler); };
  }, [socket, queryClient]);

  const [retesting, setRetesting] = useState(false);

  const handleRetest = async () => {
    setRetesting(true);
    try {
      await fetch('/api/stats/seed-placement/retest', { method: 'POST' });
      setTimeout(() => refetch(), 2000);
    } catch {}
    setTimeout(() => setRetesting(false), 5000);
  };

  const formatRelativeTime = (iso: string | null) => {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 120000) return '1 min ago';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
    if (diff < 7200000) return '1 hour ago';
    return `${Math.floor(diff / 3600000)} hours ago`;
  };

  const finalScore = data?.finalScore;
  const scoreColor = finalScore != null && finalScore >= 0
    ? finalScore >= 85 ? 'text-emerald-400'
      : finalScore >= 70 ? 'text-amber-400'
        : 'text-rose-400'
    : 'text-muted-foreground';
  const scoreRingColor = finalScore != null && finalScore >= 0
    ? finalScore >= 85 ? 'stroke-emerald-500'
      : finalScore >= 70 ? 'stroke-amber-500'
        : 'stroke-rose-500'
    : 'stroke-muted-300';

  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = finalScore != null && finalScore >= 0
    ? circumference - (finalScore / 100) * circumference
    : circumference;

  const providerLabel = (p: string) => {
    if (p.toLowerCase().includes('gmail')) return 'Gmail';
    if (p.toLowerCase().includes('outlook') || p.toLowerCase().includes('hotmail')) return 'Outlook';
    if (p.toLowerCase().includes('yahoo')) return 'Yahoo';
    if (p.toLowerCase().includes('aol')) return 'AOL';
    return p.charAt(0).toUpperCase() + p.slice(1);
  };

  const providerIcon = (p: string) => {
    if (p.toLowerCase().includes('gmail')) return 'G';
    if (p.toLowerCase().includes('outlook') || p.toLowerCase().includes('hotmail')) return 'O';
    if (p.toLowerCase().includes('yahoo')) return 'Y';
    if (p.toLowerCase().includes('aol')) return 'A';
    return '?';
  };

  if (isLoading) {
    return (
      <Card className="border-border/50 rounded-xl bg-card/40">
        <CardContent className="p-6 flex items-center justify-center">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground/40" />
        </CardContent>
      </Card>
    );
  }

  if (!data?.seedsConfigured) {
    return null;
  }

  return (
    <Card className="border-border/50 rounded-xl bg-card/40 relative overflow-hidden">
      <div className={cn(
        "absolute -top-6 -right-6 w-32 h-32 blur-[60px] rounded-full opacity-10",
        finalScore != null && finalScore >= 85 ? "bg-emerald-500"
          : finalScore != null && finalScore >= 70 ? "bg-amber-500"
            : "bg-rose-500"
      )} />

      <CardHeader className="pb-2 border-b border-border/10 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-bold uppercase tracking-[0.15em] text-primary flex items-center gap-1.5">
          <Gauge className="w-3.5 h-3.5" />
          Inbox Placement
        </CardTitle>
        <div className="flex items-center gap-2">
          {finalScore != null && finalScore < 70 && (
            <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-0 bg-rose-500/10 text-rose-400">
              <AlertTriangle className="w-2.5 h-2.5 mr-1" />
              HIGH RISK
            </Badge>
          )}
          <Badge variant="outline" className={cn(
            "text-[8px] font-bold uppercase tracking-widest border-0",
            finalScore != null && finalScore >= 85 ? "bg-emerald-500/10 text-emerald-400"
              : finalScore != null && finalScore >= 70 ? "bg-amber-500/10 text-amber-400"
                : "bg-muted/10 text-muted-foreground"
          )}>
            <Clock className="w-2.5 h-2.5 mr-1" />
            {formatRelativeTime(data?.lastTestedAt)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="8"
                  className="text-muted/10" />
                <circle cx="50" cy="50" r="40" fill="none" strokeWidth="8" strokeLinecap="round"
                  className={scoreRingColor}
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={cn("text-2xl font-black tracking-tight", scoreColor)}>
                  {finalScore !== null ? `${finalScore}` : '--'}
                  <span className="text-xs font-bold text-muted-foreground/60 ml-0.5">%</span>
                </span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">Seed Score</p>
              <p className={cn("text-lg font-black", data?.seedScore >= 85 ? "text-emerald-400" : data?.seedScore >= 70 ? "text-amber-400" : "text-rose-400")}>
                {data?.seedScore ?? 0}%
              </p>
              {data?.postmasterScore !== null && (
                <>
                  <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest mt-2">Postmaster</p>
                  <p className={cn("text-lg font-black", (data?.postmasterScore ?? 0) >= 90 ? "text-emerald-400" : "text-amber-400")}>
                    {data?.postmasterScore ?? 0}%
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {data?.providerBreakdown?.map((pb) => (
              <div key={pb.provider} className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-muted/20 flex items-center justify-center">
                  <span className="text-[9px] font-black text-muted-foreground/60">{providerIcon(pb.provider)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground">{providerLabel(pb.provider)}</span>
                  <span className={cn(
                    "text-xs font-black",
                    pb.rate >= 85 ? "text-emerald-400" : pb.rate >= 70 ? "text-amber-400" : "text-rose-400"
                  )}>
                    {pb.rate}%
                  </span>
                </div>
                <div className="w-16 h-1.5 bg-muted/10 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-700",
                      pb.rate >= 85 ? "bg-emerald-500" : pb.rate >= 70 ? "bg-amber-500" : "bg-rose-500"
                    )}
                    style={{ width: `${pb.rate}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {finalScore != null && finalScore < 70 && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-rose-400 uppercase tracking-wider">High risk of spam. Warm up more.</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Your inbox placement rate is below 70%. Increase warmup volume and check your sending reputation.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-border/10">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3 h-3 text-emerald-500" />
            <span className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-wider">
              {data?.hasSeeds ? `Seed network active` : 'No seed data'}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetest}
            disabled={retesting || isLoading}
            className="h-7 text-[9px] font-bold px-2.5 rounded-md border-border/40"
          >
            <RefreshCw className={cn("w-3 h-3 mr-1", retesting && "animate-spin")} />
            {retesting ? 'Testing...' : 'Re-test now'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
