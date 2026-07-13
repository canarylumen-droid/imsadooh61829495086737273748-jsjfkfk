import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageWrapper } from '@/components/ui/page-wrapper';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { RefreshCw, Plus, Shield, AlertTriangle, CheckCircle2, Activity, Mail, ExternalLink, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { useNavigate } from 'wouter';
import { motion } from 'framer-motion';

export default function DeliverabilityPage() {
  const [, navigate] = useNavigate();

  const { data: integrationsData, isLoading, refetch } = useQuery({
    queryKey: ['/api/integrations'],
    select: (d: any) => (d.integrations || d || []).filter((i: any) => ['gmail', 'outlook', 'custom_email'].includes(i.provider)),
  });

  const mailboxes: any[] = integrationsData || [];
  const avgScore = mailboxes.length > 0
    ? Number((mailboxes.reduce((s: number, m: any) => s + (m.reputationScore ?? 0), 0) / mailboxes.length).toFixed(2))
    : 0;
  const healthyCount = mailboxes.filter((m: any) => (m.reputationScore ?? 0) >= 70).length;
  const atRiskCount = mailboxes.filter((m: any) => (m.reputationScore ?? 0) < 70 && (m.reputationScore ?? 0) >= 40).length;
  const criticalCount = mailboxes.filter((m: any) => (m.reputationScore ?? 0) < 40).length;

  return (
    <PageWrapper className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Deliverability & Reputation</h1>
            <p className="text-sm text-muted-foreground">Per-mailbox spam score, blacklist status, DNS health, and bounce monitoring. Updates every 2 minutes.</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-card/50 border-border/40">
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mb-1">Average Reputation</p>
                <p className={cn("text-2xl font-black", avgScore >= 70 ? "text-emerald-500" : avgScore >= 40 ? "text-amber-500" : "text-red-500")}>
                  {avgScore.toFixed(2)}
                  <span className="text-sm font-medium text-muted-foreground/60 ml-1">/100</span>
                </p>
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
          </div>

          <div className="space-y-3">
            {mailboxes.map((mb: any, i: number) => {
              const score = mb.reputationScore ?? 0;
              const scoreColor = score >= 70 ? "text-emerald-500" : score >= 40 ? "text-amber-500" : "text-red-500";
              const scoreBg = score >= 70 ? "bg-emerald-500/10 border-emerald-500/20" : score >= 40 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";
              const healthLabel = score >= 70 ? "Healthy" : score >= 40 ? "At Risk" : "Critical";
              const dailyLimit = mb.initialOutreachLimit ?? mb.dailyLimit ?? 35;

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
                          <div className={cn("px-3 py-1 rounded-full border text-xs font-bold", scoreBg, scoreColor)}>
                            {score.toFixed(2)}/100
                          </div>
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
                          <Badge variant="outline" className="text-[9px] font-bold text-muted-foreground">
                            {dailyLimit}/day
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 pt-3 border-t border-border/20">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Bounces</p>
                          <p className="text-sm font-bold">{mb.bounceCount ?? 0}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Spam Reports</p>
                          <p className="text-sm font-bold text-red-500">{mb.spamCount ?? 0}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Spam Risk</p>
                          <p className="text-sm font-bold">{mb.spamRiskScore != null ? Number((mb.spamRiskScore * 100).toFixed(2)) + '%' : '0%'}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">DNS</p>
                          <p className="text-sm font-bold">
                            <Badge variant="outline" className={cn("text-[9px]", (mb as any).dnsValid ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500")}>
                              {(mb as any).dnsValid ? 'Valid' : 'Issues'}
                            </Badge>
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Pacing</p>
                          <p className="text-sm font-bold">1/{Math.round(1440 / Math.max(1, dailyLimit))}min</p>
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