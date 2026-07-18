import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Zap,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

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
  const [, setLocation] = useLocation();
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
      case 'healthy': return <ShieldCheck className="w-3.5 h-3.5" />;
      case 'fair': return <Info className="w-3.5 h-3.5" />;
      case 'poor': return <AlertTriangle className="w-3.5 h-3.5" />;
      case 'critical': return <ShieldAlert className="w-3.5 h-3.5" />;
      case 'initializing': return <RefreshCw className="w-3.5 h-3.5 animate-spin" />;
      default: return <RefreshCw className="w-3.5 h-3.5" />;
    }
  };

  const isPending = score === null;
  const effectiveStatus = !hasIntegrations ? 'critical' : (isPending ? 'initializing' : status);
  const displayScore = !hasIntegrations ? 0 : (isPending ? 0 : score);

  if (!hasIntegrations) {
    return (
      <Card className="border-border/50 rounded-xl bg-card/40 relative overflow-hidden group h-full">
        <CardHeader className="pb-2.5 border-b border-border/10 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-[0.15em] text-rose-500 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5" />
            Domain Reputation
          </CardTitle>
          <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-widest border-0 text-rose-400 bg-rose-500/10">
            Offline
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col items-center text-center py-5 gap-2.5">
          <div className="p-2.5 rounded-full bg-rose-500/10">
            <ShieldAlert className="w-5 h-5 text-rose-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground">No Mailbox Connected</h3>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-xs">
              Connect an email channel in Integrations to begin.
            </p>
          </div>
          <a href="/dashboard/integrations">
            <Badge className="bg-primary text-primary-foreground font-bold text-xs tracking-wider px-4 py-1.5 hover:bg-primary/80 cursor-pointer">
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
      
      <CardHeader className="pb-2.5 border-b border-border/10 flex flex-row items-center justify-between">
        <CardTitle className="text-xs font-bold uppercase tracking-[0.15em] text-primary flex items-center gap-1.5">
          {getStatusIcon(effectiveStatus)}
          Domain Reputation
        </CardTitle>
        <Badge variant="outline" className={cn("text-[9px] font-bold uppercase tracking-widest border-0", getStatusColor(effectiveStatus))}>
          {effectiveStatus}
        </Badge>
      </CardHeader>

      <CardContent className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">Health Score</p>
            <h3 className={cn(
              "text-xl font-black tracking-tighter",
              isPending ? "text-sky-400" : (score! >= 80 ? "text-emerald-400" : score! >= 60 ? "text-amber-400" : "text-rose-400")
            )}>
              {isPending ? "..." : `${score!.toFixed(0)}%`}
            </h3>
          </div>
          <span className="text-[9px] font-bold text-muted-foreground/30 uppercase tracking-widest flex items-center gap-1">
            {isPending ? <RefreshCw className="w-2.5 h-2.5 text-sky-500 animate-spin" /> : (score! >= 80 ? <TrendingUp className="w-2.5 h-2.5 text-emerald-500" /> : <TrendingDown className="w-2.5 h-2.5 text-rose-500" />)}
            Live
          </span>
        </div>
        <div className="relative h-1.5 w-full bg-muted/20 rounded-full overflow-hidden">
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

        <div className="flex items-center gap-2.5 pt-0.5">
          {['SPF', 'DKIM', 'DMARC', 'MX', 'BL'].map((type) => {
            const key = type === 'BL' ? 'blacklist' : type.toLowerCase();
            const val = dns ? (dns as any)[key] : undefined;
            const isGood = val === true && key !== 'blacklist';
            const isBad = key === 'blacklist' ? val === true : val === false;
            const isUnknown = val === undefined;
            return (
              <div key={type} className="flex flex-col items-center gap-0.5">
                <div className={cn("w-7 h-1 rounded-full", isPending || isUnknown ? "bg-sky-500/20" : isGood ? "bg-emerald-500/40" : "bg-rose-500/40")} />
                <span className={cn("text-[7px] font-bold uppercase", isPending || isUnknown ? "text-sky-500/60" : isGood ? "text-emerald-500/60" : "text-rose-500")}>{type}</span>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {[
            { label: 'Hard', value: bounces.hard, color: 'text-rose-400', icon: Trash2 },
            { label: 'Soft', value: bounces.soft, color: 'text-amber-400', icon: Mail },
            { label: 'Spam', value: bounces.spam, color: 'text-orange-400', icon: ShieldAlert },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} className="p-2 rounded-lg bg-muted/10 border border-border/5">
              <p className="text-[8px] font-bold text-muted-foreground/40 uppercase tracking-widest">{label}</p>
              <div className="flex items-center justify-between">
                <p className={`text-base font-black ${color} tracking-tighter`}>{value}</p>
                <Icon className="w-2.5 h-2.5 text-muted-foreground/20" />
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-primary" />
            <p className="text-xs font-bold text-primary uppercase tracking-[0.12em]">Advisory</p>
          </div>
          <p className="text-sm text-foreground/90 leading-relaxed">
            {isPending
              ? "Domain reputation assessment is currently underway."
              : (score! >= 90 ? "Reputation is solid. Max safe volume." 
              : score! >= 85 ? "Healthy signals. Standard outreach velocity." 
              : score! >= 60 ? "Minor dip in signals. 20% safety throttle applied to protect domain." 
              : score! >= 45 ? "Bounce risk detected. 50% safety throttle applied." 
              : "CRITICAL. Minimum volume to recover health.")}
          </p>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation('/dashboard/integrations')}
          className="w-full h-8 rounded-lg text-[10px] font-medium text-muted-foreground/60 hover:text-primary hover:bg-primary/5 border border-border/10"
        >
          <ExternalLink className="w-3 h-3 mr-1.5" />
          View all domains in Integrations
        </Button>
      </CardContent>
    </Card>
  );
};
