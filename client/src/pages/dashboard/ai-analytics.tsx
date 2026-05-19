import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, TrendingUp, MessageCircle, Clock, Sparkles, Loader2, Download, Zap, Target, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

// Premium Theme Colors
const COLORS = {
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--primary) / 0.6)",
  accent: "#f59e0b", // Amber
  success: "#10b981", // Emerald
  background: "hsl(var(--background))",
  grid: "hsl(var(--border) / 0.1)",
  tooltip: "hsl(var(--popover))"
};

const PIE_COLORS = [
  "hsl(var(--primary))",
  "#c026d3", // Fuchsia
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#6366f1"  // Indigo
];

interface AnalyticsResponse {
  period: string;
  summary: {
    totalLeads: number;
    conversions: number;
    conversionRate: string;
    active: number;
    leadsReplied: number;
    bestReplyHour: number | null;
  };
  channelBreakdown: Array<{ channel: string; count: number; percentage: number }>;
  statusBreakdown: Array<{ status: string; count: number; percentage: number }>;
  timeline: Array<{ date: string; leads: number; conversions: number }>;
  behaviorInsights: {
    bestReplyHour: number | null;
    replyRate: string;
    avgResponseTime: string;
    positiveSentimentRate: string;
  };
}

export default function AIAnalyticsPage() {
  const [showExportSuccess, setShowExportSuccess] = useState(false);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const { data: analytics, isLoading } = useQuery<AnalyticsResponse>({
    queryKey: ["/api/ai/analytics", { period }],
  });

  const hasData = analytics && analytics.summary && analytics.summary.totalLeads > 0;

  const handleExportPDF = () => {
    if (!analytics) return;

    // Build CSV rows from real analytics data
    const sections: string[] = [];

    // Summary
    sections.push("SUMMARY");
    sections.push("Metric,Value");
    sections.push(`Total Leads,${analytics.summary.totalLeads}`);
    sections.push(`Conversions,${analytics.summary.conversions}`);
    sections.push(`Conversion Rate,${analytics.summary.conversionRate}%`);
    sections.push(`Active Conversations,${analytics.summary.active}`);
    sections.push(`Leads Replied,${analytics.summary.leadsReplied}`);
    sections.push(`Best Reply Hour,${analytics.summary.bestReplyHour !== null ? `${analytics.summary.bestReplyHour}:00` : 'N/A'}`);
    sections.push("");

    // Behavior Insights
    sections.push("BEHAVIOR INSIGHTS");
    sections.push("Metric,Value");
    sections.push(`Reply Rate,${analytics.behaviorInsights.replyRate}%`);
    sections.push(`Avg Response Time,${analytics.behaviorInsights.avgResponseTime}`);
    sections.push(`Positive Sentiment Rate,${analytics.behaviorInsights.positiveSentimentRate}%`);
    sections.push("");

    // Channel Breakdown
    sections.push("CHANNEL BREAKDOWN");
    sections.push("Channel,Count,Percentage");
    analytics.channelBreakdown.forEach(c => {
      sections.push(`${c.channel},${c.count},${c.percentage.toFixed(1)}%`);
    });
    sections.push("");

    // Timeline
    sections.push("TIMELINE");
    sections.push("Date,New Leads,Conversions");
    analytics.timeline.forEach(t => {
      sections.push(`${t.date},${t.leads},${t.conversions}`);
    });

    const csv = sections.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `audnix-ai-analytics-${period}-${new Date().toISOString().split('T')[0]}.csv`);
    link.click();
    URL.revokeObjectURL(url);

    setShowExportSuccess(true);
    setTimeout(() => setShowExportSuccess(false), 3000);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-popover/90 backdrop-blur-md border border-border/50 p-3 rounded-xl shadow-xl text-xs">
          <p className="font-semibold mb-1 text-foreground">{label}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center gap-2 mb-0.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-muted-foreground capitalize">{entry.name}:</span>
              <span className="font-medium text-foreground">{entry.value}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="h-[60vh] flex flex-col items-center justify-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 rounded-full blur-xl animate-pulse" />
          <Loader2 className="h-10 w-10 animate-spin text-primary relative z-10" />
        </div>
        <p className="text-muted-foreground font-medium animate-pulse">Running AI Analysis...</p>
      </div>
    );
  }

  return (
    <PageWrapper className="duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <Brain className="h-8 w-8 text-primary" />
            Audnix Intelligence
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time insights on your AI sales performance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted/30 p-1 rounded-lg border border-border/40">
            {(['7d', '30d', '90d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${period === p ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <Button
            onClick={handleExportPDF}
            variant="outline"
            className="gap-2 shadow-sm border-primary/20 hover:bg-primary/5 rounded-xl h-10"
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {showExportSuccess && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 right-6 z-50 bg-emerald-500/90 backdrop-blur text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-emerald-400/30"
          >
            <Sparkles className="h-5 w-5" />
            <span className="font-medium">Report generated successfully!</span>
          </motion.div>
        )}
      </AnimatePresence>

      {!hasData ? (
        <div className="py-20 text-center space-y-6 bg-muted/5 rounded-2xl border-2 border-dashed border-border/40 mt-8">
          <div className="w-16 h-16 bg-muted rounded-full mx-auto flex items-center justify-center">
            <Activity className="h-8 w-8 opacity-20" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white">No Data Yet</h3>
            <p className="text-muted-foreground max-w-sm mx-auto mt-2">
              Connect your accounts and import leads to start seeing AI analytics.
            </p>
          </div>
          <Button onClick={() => window.location.href = '/dashboard/lead-import'} className="rounded-xl h-11">
            Import Leads
          </Button>
        </div>
      ) : (
        <div className="space-y-6 mt-8 animate-in fade-in duration-700">
          {/* Top Stat Cards */}
          <ResponsiveGrid className="md:grid-cols-2 lg:grid-cols-4 gap-6">
            <StatCard
              title="Total Leads"
              value={analytics.summary.totalLeads}
              icon={Target}
              color="text-primary"
              subtext={`${analytics.summary.active} active conversations`}
              circle
            />
            <StatCard
              title="Conversion Rate"
              value={`${analytics.summary.conversionRate}%`}
              icon={TrendingUp}
              color="text-emerald-500"
              subtext={`${analytics.summary.conversions} total conversions`}
              progress={parseFloat(analytics.summary.conversionRate)}
              circle
            />
            <StatCard
              title="Engagement Rate"
              value={`${analytics.behaviorInsights.replyRate}%`}
              icon={MessageCircle}
              color="text-purple-500"
              subtext={`${analytics.summary.leadsReplied} replies received`}
              progress={parseFloat(analytics.behaviorInsights.replyRate)}
              circle
            />
            <StatCard
              title="Avg Response Time"
              value={analytics.behaviorInsights.avgResponseTime}
              icon={Clock}
              color="text-amber-500"
              subtext="AI response latency"
            />
          </ResponsiveGrid>

          {/* Main Charts Row */}
          <ResponsiveGrid className="lg:grid-cols-3 gap-6 mt-6">
            {/* Timeline Chart (Activity) */}
            <Card className="lg:col-span-2 border-border/40 bg-card/50 backdrop-blur-sm rounded-2xl overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="h-5 w-5 text-primary" />
                  Lead Acquisition & Conversion
                </CardTitle>
                <CardDescription>Daily performance over the last {period}</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.timeline}>
                    <defs>
                      <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorConv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(val) => new Date(val).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="leads"
                      name="New Leads"
                      stroke={COLORS.primary}
                      fillOpacity={1}
                      fill="url(#colorLeads)"
                      strokeWidth={3}
                    />
                    <Area
                      type="monotone"
                      dataKey="conversions"
                      name="Conversions"
                      stroke={COLORS.success}
                      fillOpacity={1}
                      fill="url(#colorConv)"
                      strokeWidth={3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Channel Breakdown (Pie) */}
            <Card className="border-border/40 bg-card/50 backdrop-blur-sm rounded-2xl overflow-hidden">
              <CardHeader>
                <CardTitle className="text-lg">Channel Distribution</CardTitle>
                <CardDescription>Where your leads are coming from</CardDescription>
              </CardHeader>
              <CardContent className="h-[300px] relative">
                {analytics.channelBreakdown.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.channelBreakdown}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="count"
                        stroke="none"
                      >
                        {analytics.channelBreakdown.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
                {/* Custom Legend */}
                <div className="flex flex-wrap gap-3 justify-center mt-[-20px] relative z-10 px-4">
                  {analytics.channelBreakdown.map((entry, index) => (
                    <div key={entry.channel} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} />
                      <span className="text-xs font-medium capitalize text-muted-foreground">{entry.channel} ({entry.percentage.toFixed(0)}%)</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </ResponsiveGrid>

          {/* Bottom Insights */}
          <ResponsiveGrid className="md:grid-cols-2 gap-6 mt-6">
            <Card className="bg-gradient-to-br from-primary/10 via-transparent to-transparent border-primary/20 rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <Clock className="h-5 w-5 text-primary" /> Optimal Follow-Up Time
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold text-primary">
                      {analytics.behaviorInsights.bestReplyHour !== null ? `${analytics.behaviorInsights.bestReplyHour}:00` : '--:--'}
                      <span className="text-lg font-normal text-muted-foreground ml-1">
                        {analytics.behaviorInsights.bestReplyHour !== null && analytics.behaviorInsights.bestReplyHour >= 12 ? 'PM' : 'AM'}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 font-medium">Peak engagement window</p>
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-purple-500/10 via-transparent to-transparent border-purple-500/20 rounded-2xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-bold">
                  <TrendingUp className="h-4 w-4 text-primary" /> Customer Sentiment
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex justify-between mb-2 text-sm font-medium">
                      <span>Positive Interactions</span>
                      <span className="text-purple-400">{analytics.behaviorInsights.positiveSentimentRate || '0'}%</span>
                    </div>
                    <div className="h-2 w-full bg-purple-500/10 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${analytics.behaviorInsights.positiveSentimentRate || 0}%` }}
                        transition={{ duration: 1, delay: 0.5 }}
                        className="h-full bg-purple-500 rounded-full"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3 font-medium">
                  {parseFloat(analytics.behaviorInsights.positiveSentimentRate || '0') >= 70 
                    ? 'AI tone analysis indicates high satisfaction' 
                    : parseFloat(analytics.behaviorInsights.positiveSentimentRate || '0') >= 50
                      ? 'Moderate engagement - room for improvement'
                      : 'Focus on lead nurturing to improve sentiment'}
                </p>
              </CardContent>
            </Card>
          </ResponsiveGrid>
        </div>
      )}
    </PageWrapper>
  );
}

function StatCard({ title, value, icon: Icon, color, subtext, progress, circle }: any) {
  return (
    <Card className="overflow-hidden border-border/40 hover:border-primary/20 transition-all bg-card/40 backdrop-blur-xl rounded-2xl group relative">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">{title}</CardTitle>
        <Icon className={cn("h-4 w-4 transition-colors", color)} />
      </CardHeader>
      <CardContent className="flex flex-col items-center text-center pt-2">
        {circle && progress !== undefined ? (
          <div className="relative h-24 w-24 mb-4 flex items-center justify-center">
            <svg className="h-full w-full rotate-[-90deg]" viewBox="0 0 36 36">
              <path className="text-muted/10" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="2.5" />
              <motion.path
                initial={{ strokeDasharray: "0, 100" }}
                animate={{ strokeDasharray: `${progress}, 100` }}
                transition={{ duration: 1.5, ease: "easeOut" }}
                className={color}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center">
              <span className="text-2xl font-bold tracking-tighter">{value}</span>
            </div>
          </div>
        ) : (
          <div className="text-3xl font-bold tracking-tighter mb-4">{value}</div>
        )}

        {!circle && progress !== undefined && (
          <div className="w-full mb-4">
            <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
              <div className={`h-full ${color.replace('text-', 'bg-')}`} style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground/40">{subtext}</p>

        {/* Apple-style background glow */}
        <div className={cn("absolute -bottom-10 -right-10 w-32 h-32 blur-[80px] opacity-10 rounded-full", color.replace('text-', 'bg-'))} />
      </CardContent>
    </Card>
  );
}
