
import { useState } from "react";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  RefreshCw,
  Instagram,
  Mail,
  BarChart,
  Download,
  ArrowRight,
  Sparkles,
  Loader2,
  FileText,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AnimatedNumber } from "@/hooks/use-count-up";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { useCanAccessAnalytics, useCanAccessFullAnalytics } from "@/hooks/use-access-gate";
import { FeatureLock } from "@/components/upgrade/FeatureLock";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { AudnixLogo } from "@/components/ui/CustomIcons";
import { MailboxSwitcher } from "@/components/outreach/MailboxSwitcher";

interface ChannelData {
  channel: string;
  count: number;
  percentage: number;
}

interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

interface TimeSeriesData {
  date: string;
  leads: number;
}

interface InsightsMetrics {
  avgResponseTime: string;
  conversionRate: string;
  engagementScore: string;
}

interface InsightsApiResponse {
  summary: string | null;
  channels: ChannelData[];
  funnel: FunnelStage[];
  hasData: boolean;
  timeSeries: TimeSeriesData[];
  metrics?: InsightsMetrics;
}

export default function InsightsPage() {
  const { canAccess: canAccessFullAnalytics } = useCanAccessFullAnalytics();
  const { data: insightsData, isLoading, error, refetch, isFetching } = useQuery<InsightsApiResponse>({
    queryKey: ["/api/ai/insights"],
    retry: false,
  });

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
  const channelData = insightsData?.channels || [];
  const conversionFunnel = insightsData?.funnel || [];
  const timeSeriesData = insightsData?.timeSeries || [];
  const hasData = !!insightsData && (insightsData.hasData || (channelData.length > 0 || conversionFunnel.length > 0) || !!insights || timeSeriesData.length > 0);

  const PIE_COLORS = [
    "hsl(var(--primary))",
    "#c026d3", // Fuchsia
    "#f59e0b", // Amber
    "#10b981", // Emerald
    "#6366f1"  // Indigo
  ];

  const COLORS = {
    primary: "hsl(var(--primary))",
    secondary: "hsl(var(--primary) / 0.6)",
    accent: "#f59e0b", // Amber
    success: "#10b981", // Emerald
    background: "hsl(var(--background))",
    grid: "hsl(var(--border) / 0.1)",
    tooltip: "hsl(var(--popover))"
  };

  const chartConfig = {
    Instagram: {
      label: "Instagram",
      color: "#E1306C", // Specific Instagram color
    },
    Email: {
      label: "Email",
      color: COLORS.primary,
    },
  };

  if (isLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <PremiumLoader text="Synthesizing Insights..." />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent inline-flex items-center gap-2">
            AI Insights <Sparkles className="h-6 w-6 text-primary" />
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time analysis to optimize your outreach strategy.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20" onClick={() => setIsReportOpen(true)}>
            <FileText className="mr-2 h-4 w-4" /> Weekly Report
          </Button>
          <Button variant="outline" onClick={() => window.location.href = '/api/bulk/export'}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {(!hasData && !insights) ? (
        <div className="grid gap-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-20 text-center"
          >
            <AudnixLogo />
            <h3 className="text-xl font-black mt-8 text-foreground">Analyzing Intelligence</h3>
            <p className="text-muted-foreground font-medium max-w-xs mt-2">
              Gathering real-time market signals and campaign data...
            </p>
          </motion.div>
        </div>
      ) : (
        <>
          {/* AI Summary Card */}
          {insights && (
            <Card className="bg-gradient-to-br from-primary/10 via-transparent to-transparent border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-indigo-400" />
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

          {/* Metrics */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="col-span-full lg:col-span-2">
              <CardHeader>
                <CardTitle>Lead Velocity</CardTitle>
                <CardDescription>Leads generated over time.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="w-full h-full">
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={timeSeriesData}
                      margin={{
                        top: 5,
                        right: 10,
                        left: 10,
                        bottom: 0,
                      }}
                    >
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        tickLine={false}
                        axisLine={false}
                        stroke={COLORS.grid}
                        className="text-[10px] text-muted-foreground"
                      />
                      <YAxis className="text-[10px] text-muted-foreground" axisLine={false} tickLine={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line
                        type="monotone"
                        dataKey="leads"
                        strokeWidth={4}
                        stroke="hsl(var(--primary))"
                        dot={{ r: 4, fill: "hsl(var(--primary))", strokeWidth: 2, stroke: "hsl(var(--background))" }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>

            <MetricCard
              title="Network Health"
              value={!insightsData?.metrics?.engagementScore || insightsData.metrics.engagementScore === "NaN" ? "0.00" : Number(insightsData.metrics.engagementScore).toFixed(2)}
              icon={<Sparkles className="h-5 w-5 text-purple-500" />}
              description="Average lead interest"
              trend={
                !insightsData?.metrics?.engagementScore || isNaN(Number(insightsData.metrics.engagementScore))
                  ? undefined
                  : Number(insightsData.metrics.engagementScore) >= 50
                    ? "Healthy"
                    : "At Risk"
              }
              trendColor={
                !insightsData?.metrics?.engagementScore || isNaN(Number(insightsData.metrics.engagementScore))
                  ? undefined
                  : Number(insightsData.metrics.engagementScore) >= 50
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                    : "bg-red-500/10 border-red-500/20 text-red-500"
              }
            />
          </div>

          {!canAccessFullAnalytics && (
            <FeatureLock
              featureName="Advanced Analytics"
              description="Unlock deep channel analysis."
              requiredPlan="Pro"
            />
          )}


        </>
      )}

      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="w-[95vw] sm:max-w-xl bg-background border border-border/30 max-h-[85vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="mb-4 bg-muted/10 -mx-6 -mt-6 p-6 border-b border-border/10 relative">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10 w-full">
              <div className="flex items-center gap-3">
                <DialogTitle className="flex items-center gap-3 text-xl font-black uppercase tracking-widest text-foreground">
                  <Sparkles className="h-5 w-5 text-primary animate-pulse" />
                  Intelligence Briefing
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => {
                    const queryClient = (window as any).queryClient;
                    if (queryClient) {
                      queryClient.invalidateQueries({ queryKey: ["/api/ai/weekly-report", selectedMailbox] });
                    } else {
                      // Fallback if queryClient is not on window
                      refetch();
                    }
                  }}
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
              <p className="text-[10px] font-bold uppercase tracking-widest">Aggregating Global Activity Data...</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              {reportData?.text?.split('\n').map((line, i) => {
                if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-black text-foreground uppercase tracking-widest mb-4">{line.slice(3)}</h2>;
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
    </div>
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
      <Card className="bg-card border-border rounded-[2.5rem] overflow-hidden relative group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">{title}</CardTitle>
          <div className="h-10 w-10 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform">
            {icon}
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-black tracking-tighter mb-1 select-none">
            {value}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-zinc-500 font-medium">
              {description}
            </p>
            {trend && (
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
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
