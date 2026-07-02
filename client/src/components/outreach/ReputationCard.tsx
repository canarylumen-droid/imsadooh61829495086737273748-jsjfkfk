
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  ShieldCheck, 
  AlertTriangle, 
  ShieldAlert, 
  Mail, 
  Trash2, 
  Info,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface ReputationCardProps {
  score: number | null;
  status: 'healthy' | 'fair' | 'poor' | 'critical' | 'initializing';
  bounces: {
    hard: number;
    soft: number;
    spam: number;
    total: number;
  };
  dns?: {
    spf: boolean;
    dkim: boolean;
    dmarc: boolean;
    mx: boolean;
    ptr: boolean;
    blacklist: boolean;
  };
  isLoading?: boolean;
  hasIntegrations?: boolean;
}

export const ReputationCard: React.FC<ReputationCardProps> = ({ 
  score, 
  status, 
  bounces, 
  dns,
  isLoading,
  hasIntegrations = true
}) => {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'healthy': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'fair': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'poor': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'critical': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      case 'initializing': return 'text-sky-400 bg-sky-500/10 border-sky-500/20';
      default: return 'text-muted-foreground bg-muted/10 border-muted/20';
    }
  };

  const getStatusIcon = (s: string) => {
    switch (s) {
      case 'healthy': return <ShieldCheck className="w-4 h-4" />;
      case 'fair': return <Info className="w-4 h-4" />;
      case 'poor': return <AlertTriangle className="w-4 h-4" />;
      case 'critical': return <ShieldAlert className="w-4 h-4" />;
      case 'initializing': return <RefreshCw className="w-4 h-4 animate-spin" />;
      default: return <RefreshCw className="w-4 h-4" />;
    }
  };

  const isPending = score === null;
  const effectiveStatus = !hasIntegrations ? 'critical' : (isPending ? 'initializing' : status);
  const displayScore = !hasIntegrations ? 0 : (isPending ? 0 : score);

  if (!hasIntegrations) {
    return (
      <Card className="border-border/50 rounded-2xl bg-card/40 backdrop-blur-xl relative overflow-hidden group h-full">
        <div className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 rounded-full bg-rose-500" />
        
        <CardHeader className="pb-3 border-b border-border/10 flex flex-row items-center justify-between">
          <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Domain Reputation Engine
          </CardTitle>
          <Badge variant="outline" className="text-[8px] font-black uppercase tracking-widest border-0 text-rose-400 bg-rose-500/10 border-rose-500/20">
            Offline
          </Badge>
        </CardHeader>

        <CardContent className="pt-6 space-y-6 flex flex-col justify-center items-center text-center py-10">
          <div className="p-4 rounded-full bg-rose-500/10 border border-rose-500/25 mb-2">
            <ShieldAlert className="w-8 h-8 text-rose-400 animate-pulse" />
          </div>
          <div className="space-y-2 max-w-sm">
            <h3 className="text-lg font-black tracking-tight text-foreground">No Mailbox Connected</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Connect a custom SMTP, Google Workspace, or Outlook channel in your Integrations dashboard to begin domain verification and outbound tracking.
            </p>
          </div>
          <a href="/dashboard/integrations" className="mt-4">
            <Badge className="bg-primary text-black font-black uppercase text-[10px] tracking-wider px-4 py-2 hover:bg-primary/80 transition-all cursor-pointer">
              Connect Channels
            </Badge>
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 rounded-2xl bg-card/40 backdrop-blur-xl relative overflow-hidden group h-full">
      <div className={cn(
        "absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 rounded-full transition-opacity group-hover:opacity-20",
        isPending ? "bg-sky-500" : (score! >= 80 ? "bg-emerald-500" : score! >= 60 ? "bg-amber-500" : "bg-rose-500")
      )} />
      
      <CardHeader className="pb-3 border-b border-border/10 flex flex-row items-center justify-between">
        <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
          {getStatusIcon(effectiveStatus)}
          Domain Reputation Engine
        </CardTitle>
        <Badge variant="outline" className={cn("text-[8px] font-black uppercase tracking-widest border-0", getStatusColor(effectiveStatus))}>
          {effectiveStatus}
        </Badge>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest leading-none">Global Health Score</p>
              <h3 className={cn(
                "text-3xl font-black tracking-tighter",
                isPending ? "text-sky-400" : (score! >= 80 ? "text-emerald-400" : score! >= 60 ? "text-amber-400" : "text-rose-400")
              )}>
                {isPending ? "Calculating..." : `${score!.toFixed(2)}%`}
              </h3>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-bold text-muted-foreground/30 uppercase tracking-widest flex items-center gap-1 justify-end">
                {isPending ? <RefreshCw className="w-3 h-3 text-sky-500 animate-spin" /> : (score! >= 80 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-rose-500" />)}
                Live Tracking
              </span>
            </div>
          </div>
          <div className="relative h-2 w-full bg-muted/20 rounded-full overflow-hidden">
             <motion.div 
               initial={{ width: 0 }}
               animate={{ width: `${displayScore}%` }}
               transition={{ duration: 1, ease: "easeOut" }}
               className={cn(
                 "absolute top-0 left-0 h-full rounded-full",
                 isPending ? "bg-sky-500" : (score! >= 80 ? "bg-emerald-500" : score! >= 60 ? "bg-amber-500" : "bg-rose-500")
               )}
             />
          </div>
        </div>

        {/* DNS Status Grid */}
        <div className="flex flex-wrap gap-x-3 gap-y-2">
          {['SPF', 'DKIM', 'DMARC', 'MX', 'PTR', 'BLACKLIST'].map((type) => {
            const key = type === 'BLACKLIST' ? 'blacklist' : type.toLowerCase();
            const val = dns ? (dns as any)[key] : undefined;
            const isGood = val === true && key !== 'blacklist';
            const isBad = key === 'blacklist' ? val === true : val === false;
            const isUnknown = val === undefined;
            return (
              <div key={type} className="flex flex-col items-center gap-1">
                <div className={cn(
                  "w-full h-1 rounded-full",
                  isPending || isUnknown ? "bg-sky-500/20" : isGood ? "bg-emerald-500/40" : "bg-rose-500/40"
                )} />
                <span className={cn(
                  "text-[8px] font-black uppercase tracking-tighter",
                  isPending || isUnknown ? "text-sky-500/60" : isGood ? "text-emerald-500/60" : "text-rose-500"
                )}>
                  {type}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1 p-3 rounded-xl bg-muted/10 border border-border/5 hover:bg-muted/20 transition-colors">
            <p className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">Hard Bounce</p>
            <div className="flex items-center justify-between">
              <p className="text-lg font-black text-rose-400 tracking-tighter">{bounces.hard}</p>
              <Trash2 className="w-3 h-3 text-rose-400/30" />
            </div>
          </div>
          <div className="space-y-1 p-3 rounded-xl bg-muted/10 border border-border/5 hover:bg-muted/20 transition-colors">
            <p className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">Soft Bounce</p>
            <div className="flex items-center justify-between">
              <p className="text-lg font-black text-amber-400 tracking-tighter">{bounces.soft}</p>
              <Mail className="w-3 h-3 text-amber-400/30" />
            </div>
          </div>
          <div className="space-y-1 p-3 rounded-xl bg-muted/10 border border-border/5 hover:bg-muted/20 transition-colors">
            <p className="text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest">SpamHits</p>
            <div className="flex items-center justify-between">
              <p className="text-lg font-black text-orange-400 tracking-tighter">{bounces.spam}</p>
              <ShieldAlert className="w-3 h-3 text-orange-400/30" />
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 relative overflow-hidden group-hover:bg-primary/10 transition-colors">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-3 h-3 text-primary animate-pulse" />
            <p className="text-[9px] font-black text-primary uppercase tracking-[0.1em]">Autonomous Advisory</p>
          </div>
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed font-medium">
            {isPending
              ? "Domain reputation assessment is currently underway. We are verifying DNS signatures (SPF, DKIM, DMARC) and monitoring early signal indicators."
              : (score! >= 90 
              ? "Reputation is solid. Autonomous engine is in cruise control at maximum safe volume." 
              : score! >= 85 
              ? "Healthy signals. AI is maintaining standard outreach velocity." 
              : score! >= 60 
              ? "Minor reputation dip. AI has applied a 20% safety throttle to protect domain health." 
              : score! >= 45 
              ? "Significant bounce risk. AI has applied a 50% safety throttle. Outreach remains active but restricted." 
              : "Reputation CRITICAL. AI is strictly throttling volume to minimum levels to recover health while remaining active.")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
