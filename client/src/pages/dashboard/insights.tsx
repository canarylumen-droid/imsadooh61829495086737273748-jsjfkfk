import { useState } from "react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Sparkles, Loader2, FileText, Download,
  BarChart3, ArrowRight, Send, Lightbulb, Target, Activity, Clock, Zap,
} from "lucide-react";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { useQuery } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import { useCanAccessFullAnalytics } from "@/hooks/use-access-gate";
import { FeatureLock } from "@/components/upgrade/FeatureLock";
import { MailboxSwitcher } from "@/components/outreach/MailboxSwitcher";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface AnalyticsInsights {
  period: string;
  summary: string | null;
  trends: {
    leadGrowth: number;
    conversionGrowth: number;
    engagementGrowth: number;
  };
  predictions: {
    expectedConversions: number;
    projectedRevenue: number;
    riskLeads: string[];
  };
  recommendations: string[];
  topPerformers: {
    channels: Array<{ channel: string; performance: number }>;
    times: Array<{ hour: number; conversions: number }>;
  };
}

export default function InsightsPage() {
  useRealtime();
  const { canAccess: canAccessFullAnalytics } = useCanAccessFullAnalytics();
  const { data: integrationsRaw } = useQuery<any>({ queryKey: ["/api/integrations"] });
  const { data: campaigns } = useQuery<any[]>({ queryKey: ["/api/outreach/campaigns"], staleTime: 30_000 });
  const integrations = (integrationsRaw as any)?.integrations || integrationsRaw || [];

  const { data: insightsData, isLoading, refetch, isFetching } = useQuery<AnalyticsInsights>({
    queryKey: ["/api/ai/insights"],
    retry: false,
  });

  const hasMailbox = integrations?.some((i: any) => i.connected && (i.provider === 'gmail' || i.provider === 'outlook' || i.provider === 'custom_email'));
  const hasCampaign = campaigns?.some((c: any) => c.status === 'active' || c.status === 'running' || c.status === 'completed');

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [selectedMailbox, setSelectedMailbox] = useState<string | undefined>("all");

  const { data: reportData, isLoading: reportLoading, isFetching: reportFetching } = useQuery<{ text: string }>({
    queryKey: ["/api/ai/weekly-report", selectedMailbox],
    queryFn: async () => {
      const url = selectedMailbox === "all" ? "/api/ai/weekly-report" : `/api/ai/weekly-report?integrationId=${selectedMailbox}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch report");
      return res.json();
    },
    enabled: isReportOpen,
    refetchOnWindowFocus: false,
  });

  const insights = insightsData?.summary || null;
  const hasRealData = !!insightsData && (
    !!insights ||
    insightsData.trends.leadGrowth !== 0 ||
    insightsData.trends.conversionGrowth !== 0 ||
    insightsData.predictions.expectedConversions > 0 ||
    insightsData.recommendations.length > 0
  );

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <PremiumLoader text="Synthesizing Insights..." />
      </div>
    );
  }

  return (
    <PageWrapper>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent inline-flex items-center gap-2">
            AI Insights <Sparkles className="h-6 w-6 text-primary" />
          </h1>
          <p className="text-muted-foreground mt-1">
            Performance insights and analytics.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" className="bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/15 rounded-xl h-11" onClick={() => setIsReportOpen(true)}>
            <FileText className="mr-2 h-4 w-4" /> Weekly Report
          </Button>
          <Button variant="outline" className="rounded-xl h-11" onClick={() => window.location.href = '/api/bulk/export'}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button variant="outline" className="rounded-xl h-11" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {!hasRealData ? (
        <div className="grid gap-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            {!hasMailbox && !hasCampaign ? (
              <>
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center mb-6">
                  <BarChart3 className="h-10 w-10 text-indigo-400" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">No Insights Yet</h3>
                <p className="text-muted-foreground font-medium max-w-sm mb-8 leading-relaxed">
                  Insights appear once you connect a mailbox and run a campaign.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link href="/dashboard/integrations">
                    <Button className="rounded-xl h-11 px-6">
                      Connect Mailbox <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link href="/dashboard/outreach">
                    <Button variant="outline" className="rounded-xl h-11 px-6">
                      Create Campaign
                    </Button>
                  </Link>
                </div>
              </>
            ) : !hasCampaign ? (
              <>
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 flex items-center justify-center mb-6">
                  <Send className="h-10 w-10 text-amber-400" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">Awaiting Campaign Activity</h3>
                <p className="text-muted-foreground font-medium max-w-sm mb-8 leading-relaxed">
                  Your mailbox is connected! Insights will generate after your first campaign sends emails and receives replies.
                </p>
                <Link href="/dashboard/outreach">
                  <Button className="rounded-xl h-11 px-6">
                    Start a Campaign <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-sky-500/20 to-blue-500/20 border border-sky-500/20 flex items-center justify-center mb-6">
                  <BarChart3 className="h-10 w-10 text-sky-400" />
                </div>
                <h3 className="text-xl font-bold text-foreground mb-2">No Insights Yet</h3>
                <p className="text-muted-foreground font-medium max-w-sm mb-8 leading-relaxed">
                  Insights are being generated for your campaign data. Check back after more activity accumulates.
                </p>
                <Button variant="outline" className="rounded-xl h-11 px-6" onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </>
            )}
          </motion.div>
        </div>
      ) : (
        <div className="space-y-8 mt-8">
          {insights && (
            <Card className="bg-gradient-to-br from-primary/10 via-transparent to-transparent border-primary/20 rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Zap className="h-5 w-5 text-indigo-400" />
                  Performance Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg leading-relaxed font-medium text-foreground/90">
                  {insights}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Trends Row */}
          <ResponsiveGrid className="md:grid-cols-3 gap-4">
            <MetricCard
              title="Lead Growth"
              value={`${insightsData!.trends.leadGrowth >= 0 ? '+' : ''}${insightsData!.trends.leadGrowth.toFixed(1)}%`}
              icon={insightsData!.trends.leadGrowth > 0 ? <TrendingUp className="h-5 w-5 text-emerald-500" /> :
                insightsData!.trends.leadGrowth < 0 ? <TrendingDown className="h-5 w-5 text-red-500" /> :
                <Minus className="h-5 w-5 text-muted-foreground" />}
              description="vs previous period"
              trend={insightsData!.trends.leadGrowth > 0 ? "Growing" : insightsData!.trends.leadGrowth < 0 ? "Declining" : "Stable"}
              trendColor={insightsData!.trends.leadGrowth > 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
                insightsData!.trends.leadGrowth < 0 ? "bg-red-500/10 border-red-500/20 text-red-500" :
                "bg-muted/20 border-border/20 text-muted-foreground"}
            />
            <MetricCard
              title="Conversion Rate"
              value={`${insightsData!.trends.conversionGrowth >= 0 ? '+' : ''}${insightsData!.trends.conversionGrowth.toFixed(1)}%`}
              icon={insightsData!.trends.conversionGrowth > 10 ? <TrendingUp className="h-5 w-5 text-emerald-500" /> :
                insightsData!.trends.conversionGrowth < -10 ? <TrendingDown className="h-5 w-5 text-red-500" /> :
                <Activity className="h-5 w-5 text-muted-foreground" />}
              description="conversion trend"
              trend={insightsData!.trends.conversionGrowth > 10 ? "Improving" :
                insightsData!.trends.conversionGrowth < -10 ? "Dropping" : "Stable"}
              trendColor={insightsData!.trends.conversionGrowth > 10 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
                insightsData!.trends.conversionGrowth < -10 ? "bg-red-500/10 border-red-500/20 text-red-500" :
                "bg-muted/20 border-border/20 text-muted-foreground"}
            />
            <MetricCard
              title="Engagement"
              value={`${insightsData!.trends.engagementGrowth >= 0 ? '+' : ''}${insightsData!.trends.engagementGrowth.toFixed(1)}%`}
              icon={<Activity className="h-5 w-5 text-purple-500" />}
              description="engagement growth"
              trend={insightsData!.trends.engagementGrowth > 0 ? "Up" :
                insightsData!.trends.engagementGrowth < 0 ? "Down" : "Flat"}
              trendColor={insightsData!.trends.engagementGrowth > 0 ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500" :
                insightsData!.trends.engagementGrowth < 0 ? "bg-red-500/10 border-red-500/20 text-red-500" :
                "bg-muted/20 border-border/20 text-muted-foreground"}
            />
          </ResponsiveGrid>

          {/* Predictions & Top Performers */}
          <ResponsiveGrid className="md:grid-cols-2 gap-6">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-sky-500" />
                  AI Predictions
                </CardTitle>
                <CardDescription>Projected outcomes based on current trends</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-muted/20 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Expected Conversions</p>
                    <p className="text-3xl font-bold">{insightsData!.predictions.expectedConversions}</p>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-sky-500" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-4 bg-muted/20 rounded-xl">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Projected Revenue</p>
                    <p className="text-3xl font-bold">${insightsData!.predictions.projectedRevenue.toLocaleString()}</p>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-emerald-500" />
                  </div>
                </div>
                {insightsData!.predictions.riskLeads.length > 0 && (
                  <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                    <p className="text-sm font-semibold text-amber-600 flex items-center gap-2 mb-2">
                      <Clock className="h-4 w-4" /> At-Risk Leads ({insightsData!.predictions.riskLeads.length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      These leads haven't been contacted in 24+ hours. Consider re-engaging them.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-amber-500" />
                  Recommendations
                </CardTitle>
                <CardDescription>AI-powered suggestions to improve performance</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {insightsData!.recommendations.length > 0 ? (
                  insightsData!.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-primary/5 border border-primary/10 rounded-xl">
                      <Lightbulb className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                      <p className="text-sm text-foreground/80">{rec}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">No recommendations yet. Keep building your pipeline!</p>
                )}
              </CardContent>
            </Card>
          </ResponsiveGrid>

          {/* Top Performers */}
          {(insightsData!.topPerformers.channels.length > 0 || insightsData!.topPerformers.times.length > 0) && (
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Top Performers
                </CardTitle>
                <CardDescription>Best performing channels and sending times</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveGrid className="md:grid-cols-2 gap-6">
                  {insightsData!.topPerformers.channels.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Channels</h4>
                      <div className="space-y-2">
                        {insightsData!.topPerformers.channels.map((ch, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-muted/10 rounded-xl">
                            <span className="text-sm font-medium capitalize">{ch.channel}</span>
                            <Badge variant="secondary" className="text-xs">
                              {ch.performance.toFixed(1)}% conversion
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {insightsData!.topPerformers.times.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Best Sending Times</h4>
                      <div className="space-y-2">
                        {insightsData!.topPerformers.times.slice(0, 5).map((t, i) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-muted/10 rounded-xl">
                            <span className="text-sm font-medium">{t.hour}:00</span>
                            <Badge variant="secondary" className="text-xs">
                              {t.conversions} conversions
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ResponsiveGrid>
              </CardContent>
            </Card>
          )}

          {!canAccessFullAnalytics && (
            <FeatureLock
              featureName="Advanced Analytics"
              description="Unlock deep channel analysis, historical comparisons, and predictive modeling."
              requiredPlan="Pro"
            />
          )}
        </div>
      )}

      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="w-[95vw] sm:max-w-xl bg-background border border-border/30 max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="mb-4 bg-muted/10 -mx-6 -mt-6 p-6 border-b border-border/10 relative">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10 w-full">
              <div className="flex items-center gap-3">
                <DialogTitle className="flex items-center gap-3 text-lg font-bold uppercase tracking-wider text-foreground">
                  <Sparkles className="h-5 w-5 text-primary animate-pulse" />
                  Intelligence Briefing
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => { refetch(); }}
                  disabled={reportLoading || reportFetching}
                >
                  <RefreshCw className={cn("h-4 w-4", (reportLoading || reportFetching) && "animate-spin")} />
                </Button>
              </div>
              <MailboxSwitcher
                value={selectedMailbox}
                onValueChange={setSelectedMailbox}
                className="w-full md:w-auto"
              />
            </div>
          </DialogHeader>
          {(reportLoading || reportFetching) ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-[10px] font-semibold uppercase tracking-wider">Aggregating Global Activity Data...</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {reportData?.text?.split('\n').map((line, i) => {
                if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-foreground uppercase tracking-wider mb-4">{line.slice(3)}</h2>;
                if (line.startsWith('### ')) return <h3 key={i} className="flex items-center gap-2 text-sm font-bold text-primary mt-6 mb-3 uppercase tracking-wider"><div className="w-1.5 h-1.5 rounded-full bg-primary" />{line.slice(4)}</h3>;
                if (line.startsWith('- ')) {
                  const parts = line.slice(2).split('**');
                  if (parts.length >= 3) {
                    return <li key={i} className="flex items-start gap-3 bg-muted/10 p-3 rounded-xl border border-border/30 list-none"><span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" /><span className="text-sm font-medium"><strong>{parts[1]}</strong>{parts[2]}</span></li>;
                  }
                  return <li key={i} className="flex items-start gap-3 bg-muted/10 p-3 rounded-xl border border-border/30 list-none"><span className="w-1.5 h-1.5 rounded-full bg-primary/40 mt-1.5 shrink-0" /><span className="text-sm font-medium">{line.slice(2)}</span></li>;
                }
                if (line.trim() === '') return null;
                return <p key={i} className="text-xs text-muted-foreground font-medium leading-relaxed italic border-l-2 border-primary/20 pl-4 py-2 bg-muted/5">{line}</p>;
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}

function MetricCard({ title, value, icon, description, trend, trendColor }: {
  title: string;
  value: string;
  icon: React.ReactNode;
  description: string;
  trend?: string;
  trendColor?: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -5, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300 }}
    >
      <Card className="bg-card border-border rounded-2xl overflow-hidden relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</CardTitle>
          <div className="h-10 w-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform">
            {icon}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold tracking-tight mb-1 select-none">
            {value}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-zinc-500 font-medium">
              {description}
            </p>
            {trend && (
              <span className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                trendColor || "bg-primary/10 border-primary/20 text-primary"
              )}>
                {trend}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
