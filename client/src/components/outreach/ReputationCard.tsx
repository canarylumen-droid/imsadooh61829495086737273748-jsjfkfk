
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
  score: number;
  status: 'healthy' | 'fair' | 'poor' | 'critical';
  bounces: {
    hard: number;
    soft: number;
    spam: number;
    total: number;
  };
  isLoading?: boolean;
}

export const ReputationCard: React.FC<ReputationCardProps> = ({ 
  score, 
  status, 
  bounces, 
  isLoading 
}) => {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'healthy': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'fair': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      case 'poor': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
      case 'critical': return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
      default: return 'text-muted-foreground bg-muted/10 border-muted/20';
    }
  };

  const getStatusIcon = (s: string) => {
    switch (s) {
      case 'healthy': return <ShieldCheck className="w-4 h-4" />;
      case 'fair': return <Info className="w-4 h-4" />;
      case 'poor': return <AlertTriangle className="w-4 h-4" />;
      case 'critical': return <ShieldAlert className="w-4 h-4" />;
      default: return <RefreshCw className="w-4 h-4" />;
    }
  };

  const scorePercentage = score;

  return (
    <Card className="border-border/50 rounded-2xl bg-card/40 backdrop-blur-xl relative overflow-hidden group h-full">
      <div className={cn(
        "absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 rounded-full transition-opacity group-hover:opacity-20",
        score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-rose-500"
      )} />
      
      <CardHeader className="pb-3 border-b border-border/10 flex flex-row items-center justify-between">
        <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
          {getStatusIcon(status)}
          Domain Reputation Engine
        </CardTitle>
        <Badge variant="outline" className={cn("text-[8px] font-black uppercase tracking-widest border-0", getStatusColor(status))}>
          {status}
        </Badge>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <div className="space-y-0.5">
              <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest leading-none">Global Health Score</p>
              <h3 className={cn(
                "text-3xl font-black tracking-tighter",
                score >= 80 ? "text-emerald-400" : score >= 60 ? "text-amber-400" : "text-rose-400"
              )}>
                {score.toFixed(2)}%
              </h3>
            </div>
            <div className="text-right">
              <span className="text-[9px] font-bold text-muted-foreground/30 uppercase tracking-widest flex items-center gap-1 justify-end">
                {score >= 80 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-rose-500" />}
                Live Tracking
              </span>
            </div>
          </div>
          <div className="relative h-2 w-full bg-muted/20 rounded-full overflow-hidden">
             <motion.div 
               initial={{ width: 0 }}
               animate={{ width: `${score}%` }}
               transition={{ duration: 1, ease: "easeOut" }}
               className={cn(
                 "absolute h-full rounded-full transition-all duration-1000",
                 score >= 80 ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : 
                 score >= 60 ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" : 
                 "bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]"
               )}
             />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
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
            {score >= 90 
              ? "Reputation is solid. Autonomous engine is in cruise control at maximum safe volume." 
              : score >= 70 
              ? "Minor health degradation detected. AI has automatically applied a 15% volume throttle." 
              : score >= 40 
              ? "Significant bounce risk. AI has applied a 50% safety throttle. Review lead verification." 
              : "Reputation CRITICAL. Autonomous engine has PAUSED outreach to prevent domain blacklisting."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
