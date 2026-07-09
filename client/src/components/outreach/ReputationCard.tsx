import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
      case 'healthy': return <ShieldCheck className="w-3 h-3" />;
      case 'fair': return <Info className="w-3 h-3" />;
      case 'poor': return <AlertTriangle className="w-3 h-3" />;
      case 'critical': return <ShieldAlert className="w-3 h-3" />;
      case 'initializing': return <RefreshCw className="w-3 h-3 animate-spin" />;
      default: return <RefreshCw className="w-3 h-3" />;
    }
  };

  const isPending = score === null;
  const effectiveStatus = !hasIntegrations ? 'critical' : (isPending ? 'initializing' : status);
  const displayScore = !hasIntegrations ? 0 : (isPending ? 0 : score);

  if (!hasIntegrations) {
    return (
      <Card className="border-border/50 rounded-xl bg-card/40 relative overflow-hidden group h-full">
        <CardHeader className="pb-2 border-b border-border/10 flex flex-row items-center justify-between">
          <CardTitle className="text-[9px] font-bold uppercase tracking-[0.15em] text-rose-500 flex items-center gap-1.5">
            <ShieldAlert className="w-3 h-3" />
            Domain Reputation
          </CardTitle>
          <Badge variant="outline" className="text-[7px] font-bold uppercase tracking-widest border-0 text-rose-400 bg-rose-500/10">
            Offline
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col items-center text-center py-4 gap-2">
          <div className="p-2 rounded-full bg-rose-500/10">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-foreground">No Mailbox Connected</h3>
            <p className="text-[10px] text-muted-foreground leading-relaxed max-w-xs">
              Connect an email channel in Integrations to begin.
            </p>
          </div>
          <a href="/dashboard/integrations">
            <Badge className="bg-primary text-black font-bold text-[9px] tracking-wider px-3 py-1 hover:bg-primary/80 cursor-pointer">
              Connect
            </Badge>
          </a>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 rounded-xl bg-card/40 relative overflow-hidden group h-full">
      <div className={cn(
        "absolute top-0 right-0 w-24 h-24 blur-[50px] opacity-10 rounded-full",
        isPending ? "bg-sky-500" : (score! >= 80 ? "bg-emerald-500" : score! >= 60 ? "bg-amber-500" : "bg-rose-500")
      )} />
      
      <CardHeader className="pb-2 border-b border-border/10 flex flex-row items-center justify-between min-h-0">
        <CardTitle className="text-[9px] font-bold uppercase tracking-[0.15em] text-primary flex items-center gap-1.5">
          {getStatusIcon(effectiveStatus)}
          Domain Reputation
        </CardTitle>
        <Badge variant="outline" className={cn("text-[7px] font-bold uppercase tracking-widest border-0", getStatusColor(effectiveStatus))}>
          {effectiveStatus}
        </Badge>
      </CardHeader>

      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest">Score</p>
            <h3 className={cn(
              "text-lg font-black tracking-tighter",
              isPending ? "text-sky-400" : (score! >= 80 ? "text-emerald-400" : score! >= 60 ? "text-amber-400" : "text-rose-400")
            )}>
              {isPending ? "..." : `${score!.toFixed(0)}%`}
            </h3>
          </div>
          <span className="text-[7px] font-bold text-muted-foreground/30 uppercase tracking-widest flex items-center gap-1">
            {isPending ? <RefreshCw className="w-2 h-2 text-sky-500 animate-spin" /> : (score! >= 80 ? <TrendingUp className="w-2 h-2 text-emerald-500" /> : <TrendingDown className="w-2 h-2 text-rose-500" />)}
            Live
          </span>
        </div>
        <div className="relative h-1 w-full bg-muted/20 rounded-full overflow-hidden">
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

        <div className="flex items-center gap-2 pt-0.5">
          {['SPF', 'DKIM', 'DMARC', 'MX', 'PTR', 'BL'].map((type) => {
            const key = type === 'BL' ? 'blacklist' : type.toLowerCase();
            const val = dns ? (dns as any)[key] : undefined;
            const isGood = val === true && key !== 'blacklist';
            const isBad = key === 'blacklist' ? val === true : val === false;
            const isUnknown = val === undefined;
            return (
              <div key={type} className="flex flex-col items-center gap-0.5">
                <div className={cn("w-6 h-0.5 rounded-full", isPending || isUnknown ? "bg-sky-500/20" : isGood ? "bg-emerald-500/40" : "bg-rose-500/40")} />
                <span className={cn("text-[6px] font-bold uppercase", isPending || isUnknown ? "text-sky-500/60" : isGood ? "text-emerald-500/60" : "text-rose-500")}>{type}</span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-1">
          {[
            { label: 'Hard', value: bounces.hard, color: 'text-rose-400', icon: Trash2 },
            { label: 'Soft', value: bounces.soft, color: 'text-amber-400', icon: Mail },
            { label: 'Spam', value: bounces.spam, color: 'text-orange-400', icon: ShieldAlert },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="p-1.5 rounded-lg bg-muted/10 border border-border/5">
              <p className="text-[7px] font-bold text-muted-foreground/40 uppercase tracking-widest">{label}</p>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-black ${color} tracking-tighter`}>{value}</p>
                <Icon className="w-2 h-2 text-muted-foreground/20" />
              </div>
            </div>
          ))}
        </div>

        <div className="p-2 rounded-lg bg-primary/5 border border-primary/10">
          <div className="flex items-center gap-1 mb-0.5">
            <Zap className="w-2 h-2 text-primary" />
            <p className="text-[7px] font-bold text-primary uppercase tracking-[0.08em]">Advisory</p>
          </div>
          <p className="text-[9px] text-muted-foreground/80 leading-snug">
            {isPending
              ? "Assessment underway."
              : (score! >= 90 ? "Solid. Max safe volume." 
              : score! >= 85 ? "Healthy. Standard velocity." 
              : score! >= 60 ? "Minor dip. 20% throttle." 
              : score! >= 45 ? "Bounce risk. 50% throttle." 
              : "CRITICAL. Minimum volume.")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
