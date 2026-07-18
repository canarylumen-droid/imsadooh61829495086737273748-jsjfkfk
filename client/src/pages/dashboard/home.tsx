
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getActivePlanId } from "@shared/plan-utils";
import { useMailbox } from "@/hooks/use-mailbox";
import {
  ArrowRight,
  Users,
  Zap,
  Mail,
  Activity,
  RefreshCw,
  Sparkles,
  Send,
  Brain,
  Info,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  AlertTriangle,
  Target,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useLocation } from "wouter";
import { useReducedMotion } from "@/lib/animation-utils";
import { formatRelativeTime } from "@/lib/format-date";
import { useRealtime } from "@/hooks/use-realtime";
import { useState, useEffect } from "react";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { MailboxSwitcher } from "@/components/outreach/MailboxSwitcher";
import { AutonomousActionFeed } from "@/components/outreach/AutonomousActionFeed";
import { ReputationCard } from "@/components/outreach/ReputationCard";
import { ReputationTrendChart } from "@/components/outreach/ReputationTrendChart";
import { RecentConversations } from "@/components/dashboard/RecentConversations";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface UserProfile {
  id: string;
  email: string;
  username?: string;
  name?: string;
  role: string;
  plan: string;
  businessName?: string;
  trialExpiresAt?: string;
  voiceNotesEnabled?: boolean;
  subscriptionTier?: string;
  metadata?: {
    onboardingCompleted?: boolean;
    [key: string]: unknown;
  };
}

interface DashboardStats {
  leads: number;
  messages: number;
  aiReplies: number;
  conversionRate: number;
  conversions: number;
  totalLeads?: number;
  newLeads?: number;
  activeLeads?: number;
  convertedLeads?: number;
  totalMessages?: number;
  outreachedLeads?: number;
  hardenedLeads?: number;
  bouncyLeads?: number;
  recoveredLeads?: number;
  sync?: {
    status: string;
    lastSync: string | null;
    activeMonitors: number;
    isAutonomous: boolean;
  };
  openRate?: number;
  responseRate?: number;
  pipelineValue?: number;
  closedRevenue?: number;
  queuedLeads?: number;
  undeliveredLeads?: number;
  domainHealth?: number;
    health?: {
        score: number | null;
        status: 'healthy' | 'fair' | 'poor' | 'critical' | 'initializing';
        reputation: number | null;
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
  };
  benchmarks?: {
    avgLeadScore: number;
    avgOpenRate: number;
    avgResponseRate: number;
    marketSentiment: string;
  };
  aiActionLogs?: any[];
  reputationTrend?: any[];
  globalBounceRate?: number;
  timeSaved?: number;
}

interface PreviousDashboardStats {
  leads: number;
  messages: number;
  aiReplies: number;
  conversions: number;
  totalLeads?: number;
  convertedLeads?: number;
  openRate?: number;
  responseRate?: number;
  closedRevenue?: number;
  conversionRate?: number;
}

interface ActivityItem {
  id: string;
  type: string;
  message: string;
  time: string | Date;
  channel: string;
  title?: string;
  description?: string;
  timestamp?: string | Date;
  leadId?: string;
}

interface DashboardActivityResponse {
  activities: ActivityItem[];
}

const channelIcons = {
  email: Mail,
};

export default function DashboardHome() {
  const queryClient = useQueryClient();
  const prefersReducedMotion = useReducedMotion();
  const { socket } = useRealtime();
  const { selectedMailboxId: selectedIntegrationId, setSelectedMailboxId: setSelectedIntegrationId } = useMailbox();
  const [, setLocation] = useLocation();

  // Listen for socket updates
  useEffect(() => {
    if (!socket) return;

    let settingsTimeout: NodeJS.Timeout;
    const handleSettingsUpdated = () => {
      clearTimeout(settingsTimeout);
      settingsTimeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/integrations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      }, 50);
    };

    let statsTimeout: ReturnType<typeof setTimeout>;
    const handleStatsUpdated = () => {
      clearTimeout(statsTimeout);
      statsTimeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      }, 50);
    };

    let activityTimeout: NodeJS.Timeout;
    const handleActivityUpdated = () => {
      clearTimeout(activityTimeout);
      activityTimeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/activity"] });
      }, 50);
    };

    const handleLeadsUpdated = () => {
      handleStatsUpdated();
      handleActivityUpdated();
    };

    socket.on('settings_updated', handleSettingsUpdated);
    socket.on('stats_updated', handleStatsUpdated);
    socket.on('activity_updated', handleActivityUpdated);
    socket.on('leads_updated', handleLeadsUpdated);
    socket.on('notification', handleActivityUpdated); // Refresh activity on notification
    socket.on('dns_verified', () => {
      clearTimeout(statsTimeout);
      statsTimeout = setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] }), 300) as any;
    });

    return () => {
      socket.off('settings_updated', handleSettingsUpdated);
      socket.off('stats_updated', handleStatsUpdated);
      socket.off('activity_updated', handleActivityUpdated);
      socket.off('leads_updated', handleLeadsUpdated);
      socket.off('notification', handleActivityUpdated);
      socket.off('dns_verified');
      clearTimeout(settingsTimeout);
      clearTimeout(statsTimeout);
      clearTimeout(activityTimeout);
    };
  }, [socket, queryClient]);

  // Fetch real user profile
  const { data: user, isLoading: userLoading } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    retry: false,
  });

  const { data: statsData, isLoading: statsLoading, isFetching: statsFetching } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", { integrationId: selectedIntegrationId }],
    queryFn: async () => {
      const url = new URL("/api/dashboard/stats", window.location.origin);
      if (selectedIntegrationId) url.searchParams.set("integrationId", selectedIntegrationId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData,
  });

  const { data: previousStats } = useQuery<PreviousDashboardStats>({
    queryKey: ["/api/dashboard/stats/previous", { integrationId: selectedIntegrationId }],
    queryFn: async () => {
      const url = new URL("/api/dashboard/stats/previous", window.location.origin);
      if (selectedIntegrationId) url.searchParams.set("integrationId", selectedIntegrationId);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch previous stats");
      return res.json();
    },
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  const [limit, setLimit] = useState(20);
  const { data: activityData, isLoading: activityLoading, isFetching: activityFetching } = useQuery<DashboardActivityResponse>({
    queryKey: ["/api/dashboard/activity", { integrationId: selectedIntegrationId, limit }],
    queryFn: async () => {
      const url = new URL("/api/dashboard/activity", window.location.origin);
      if (selectedIntegrationId) url.searchParams.set("integrationId", selectedIntegrationId);
      url.searchParams.set("days", "0"); // Perpetual history
      url.searchParams.set("limit", limit.toString());
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch activity");
      return res.json();
    },
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  const handleLoadMore = () => {
    setLimit(prev => prev + 20);
  };

  const { data: integrations } = useQuery<any[]>({
    queryKey: ["/api/integrations"],
    select: (data: any) => data.integrations || [],
  });

  const activities = activityData?.activities || [];

  const { data: insightsData } = useQuery<any>({
    queryKey: ["/api/ai/insights", { period: '7d' }],
    refetchOnWindowFocus: false,
    enabled: !!activities && activities.length > 0 && !!user, // Only fetch inside dashboard if activities exist
  });

  const { data: campaigns } = useQuery<any[]>({
    queryKey: ["/api/outreach/campaigns"],
    staleTime: 30_000,
    enabled: !!user,
  });

  const activeCampaign = campaigns?.find((c: any) => c.status === 'active' || c.status === 'running');

  const isSmtpConnected = integrations?.some((i: any) => (i.provider === 'gmail' || i.provider === 'outlook' || i.provider === 'custom_email') && i.connected);
  const stats = statsData;
  const userData = user;

  const getNextPlan = () => {
    const tier = getActivePlanId(userData);
    if (tier === 'starter') return 'Pro';
    if (tier === 'pro') return 'Enterprise';
    return null;
  };

  const getTrialDaysLeft = () => {
    if (!user?.plan || user.plan !== "trial" || !user?.trialExpiresAt) return 0;
    const now = new Date();
    const expiryDate = new Date(user.trialExpiresAt);
    const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysLeft);
  };

  const trialDaysLeft = getTrialDaysLeft();

  const calculatePercentageChange = (current: number, previous: number | undefined): number | null => {
    if (!previousStats || previous === undefined) return null;
    if (previous === 0) return current > 0 ? 100 : null;
    const change = ((current - previous) / previous) * 100;
    if (isNaN(change) || !isFinite(change)) return null;
    return Number(change.toFixed(2));
  };

  const summaryMetrics = [
    {
      label: "TOTAL LEADS",
      value: stats?.leads ?? stats?.totalLeads ?? 0,
      icon: Users,
      percentage: calculatePercentageChange(stats?.leads ?? 0, previousStats?.leads),
      trend: previousStats ? ((stats?.leads ?? 0) > (previousStats?.leads || 0) ? "up" : (stats?.leads ?? 0) < (previousStats?.leads || 0) ? "down" : "neutral") : "neutral",
      color: "text-indigo-500",
      bgColor: "bg-indigo-500/10",
      borderColor: "border-indigo-500/20",
      glow: "hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]"
    },
    {
      label: "SENT",
      value: stats?.outreachedLeads ?? stats?.totalMessages ?? 0,
      icon: Send,
      percentage: calculatePercentageChange(stats?.outreachedLeads ?? stats?.totalMessages ?? 0, previousStats?.messages),
      trend: previousStats ? ((stats?.outreachedLeads ?? stats?.totalMessages ?? 0) > (previousStats?.messages || 0) ? "up" : (stats?.outreachedLeads ?? stats?.totalMessages ?? 0) < (previousStats?.messages || 0) ? "down" : "neutral") : "neutral",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      glow: "hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
    },
    {
      label: "OPEN RATE",
      value: (stats?.openRate === null || stats?.openRate === undefined) ? "—" : stats.openRate.toFixed(1),
      suffix: (stats?.openRate === null || stats?.openRate === undefined) ? "" : "%",
      icon: Mail,
      percentage: calculatePercentageChange(stats?.openRate || 0, previousStats?.openRate),
      trend: previousStats ? ((stats?.openRate || 0) > (previousStats?.openRate || 0) ? "up" : (stats?.openRate || 0) < (previousStats?.openRate || 0) ? "down" : "neutral") : "neutral",
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
      glow: "group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]"
    },
    {
      label: "RESPONSES",
      value: (stats?.responseRate === null || stats?.responseRate === undefined) ? "—" : stats.responseRate.toFixed(1),
      suffix: (stats?.responseRate === null || stats?.responseRate === undefined) ? "" : "%",
      icon: MessageSquare,
      percentage: calculatePercentageChange(stats?.responseRate || 0, previousStats?.responseRate),
      trend: previousStats ? ((stats?.responseRate || 0) > (previousStats?.responseRate || 0) ? "up" : (stats?.responseRate || 0) < (previousStats?.responseRate || 0) ? "down" : "neutral") : "neutral",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
      glow: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]"
    },
    {
      label: "CONVERTED",
      value: stats?.conversions ?? stats?.convertedLeads ?? 0,
      icon: Zap,
      percentage: calculatePercentageChange(stats?.conversions || 0, previousStats?.conversions),
      trend: previousStats ? ((stats?.conversions || 0) > (previousStats?.conversions || 0) ? "up" : (stats?.conversions || 0) < (previousStats?.conversions || 0) ? "down" : "neutral") : "neutral",
      color: "text-primary",
      bgColor: "bg-primary/10",
      borderColor: "border-primary/20",
      glow: "hover:shadow-[0_0_20px_rgba(var(--primary),0.15)]"
    },
    {
      label: "BOUNCE RATE",
      value: (stats?.globalBounceRate === null || stats?.globalBounceRate === undefined) ? "—" : (stats.globalBounceRate * 100).toFixed(1),
      suffix: (stats?.globalBounceRate === null || stats?.globalBounceRate === undefined) ? "" : "%",
      icon: AlertTriangle,
      percentage: null,
      trend: "neutral",
      color: "text-rose-500",
      bgColor: "bg-rose-500/10",
      borderColor: "border-rose-500/20",
      glow: "hover:shadow-[0_0_20px_rgba(244,63,94,0.15)]"
    },
    {
      label: "DEALS",
      value: stats?.wonCount ?? stats?.pipelineValue ?? 0,
      icon: Target,
      percentage: calculatePercentageChange(stats?.wonCount ?? 0, previousStats?.wonCount ?? previousStats?.conversions ?? 0),
      trend: previousStats ? ((stats?.wonCount ?? 0) > (previousStats?.wonCount ?? previousStats?.conversions ?? 0) ? "up" : (stats?.wonCount ?? 0) < (previousStats?.wonCount ?? previousStats?.conversions ?? 0) ? "down" : "neutral") : "neutral",
      color: "text-violet-500",
      bgColor: "bg-violet-500/10",
      borderColor: "border-violet-500/20",
      glow: "hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]"
    },
  ];

  if (statsLoading || userLoading) {
    return (
      <div className="h-[60vh] flex items-center justify-center">
        <PremiumLoader text="Loading Dashboard..." />
      </div>
    );
  }

  const hasAnyActivity = stats && (stats.leads > 0 || stats.messages > 0 || stats.aiReplies > 0);
  const showEmptyState = !statsLoading && stats && (stats.leads === 0 && stats.messages === 0) && !isSmtpConnected;
  const cleanInsightSummary = insightsData?.summary ? insightsData.summary.split('**').join('') : "";

  return (
    <PageWrapper className="space-y-5">
      {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/20">
          <div className="space-y-1">
            <h1 className="text-2xl md:text-3xl font-black text-foreground break-words sm:break-normal">
                Welcome, {user?.name?.split(' ')[0] || user?.username || 'Partner'}
            </h1>
            <p className="text-muted-foreground/60 text-sm font-medium tracking-tight">
              {isSmtpConnected ? "Outreach engine performing optimally." : "Connect SMTP to start automation."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg border-border/40 hover:bg-muted/50 transition-all font-bold uppercase tracking-wider text-[10px] h-9 px-4 backdrop-blur-md"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
                queryClient.invalidateQueries({ queryKey: ["/api/dashboard/activity"] });
              }}
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${statsFetching || activityFetching ? 'animate-spin' : ''}`} />
              {statsFetching || activityFetching ? 'Refreshing...' : 'Refresh Data'}
            </Button>
            <MailboxSwitcher
              value={selectedIntegrationId}
              onValueChange={setSelectedIntegrationId}
              className="flex w-full md:w-auto"
            />
            {stats?.sync?.isAutonomous && (
              <Badge variant="outline" className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 border-emerald-500/20 rounded-lg font-semibold text-[10px]">
                <span className="w-1.5 h-1.5 mr-1.5 bg-emerald-500 rounded-full inline-block animate-pulse" />
                Engine Live
              </Badge>
            )}
            {stats?.sync?.lastSync && !stats?.sync?.isAutonomous && (
              <Badge variant="outline" className="px-3 py-1.5 bg-muted/20 text-muted-foreground border-border/30 rounded-lg font-medium text-[10px]">
                <RefreshCw className="w-3 h-3 mr-1.5 opacity-40" />
                Synced {formatRelativeTime(stats.sync.lastSync)}
              </Badge>
            )}
            {trialDaysLeft > 0 && (
              <Badge variant="outline" className="px-3 py-1.5 bg-primary/5 text-primary border-primary/20 rounded-lg font-bold text-[11px] shadow-sm shadow-primary/5">
                <Sparkles className="w-4 h-4 mr-2" />
                {trialDaysLeft} DAYS REMAINING
              </Badge>
            )}
          </div>
        </div>

        {/* AI Smart Scheduling Banner */}
        {insightsData?.summary && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative overflow-hidden group bg-primary/10 border border-primary/20 rounded-lg p-4 shadow-sm shadow-primary/5 mb-5"
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[40px] md:blur-[80px] rounded-full translate-x-1/2 -translate-y-1/2 group-hover:bg-primary/20 transition-all duration-700" />
            <div className="flex flex-col md:flex-row items-center gap-6 relative z-10">
              <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center text-primary shrink-0 animate-pulse">
                <Brain className="h-5 w-5" />
              </div>
              <div className="flex-1 space-y-1 text-center md:text-left">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-primary/60">Standard Peak Window</h3>
                <p className="text-sm font-bold text-foreground/90">
                  AI predicts your optimal sending window is <span className="text-primary font-bold uppercase tracking-wider">{insightsData.bestReplyHour || 14}:00 - {((insightsData.bestReplyHour || 14) + 2) % 24}:00</span> based on recent patterns.
                </p>
                <div className="flex items-center justify-center md:justify-start gap-4 mt-2">
                  <Badge variant="outline" className="bg-primary/5 text-[9px] font-semibold uppercase tracking-wider px-3 py-1 border-primary/10">
                    <Zap className="w-3 h-3 mr-1.5" /> Adaptive Frequency: ON
                  </Badge>
                  <Badge variant="outline" className="bg-primary/5 text-[9px] font-semibold uppercase tracking-wider px-3 py-1 border-primary/10">
                    <Activity className="w-3 h-3 mr-1.5" /> High Deliverability
                  </Badge>
                </div>
              </div>
              <Button
                variant="default"
                className="rounded-lg bg-primary hover:bg-primary/90 text-[10px] font-bold uppercase tracking-wider h-9 px-4 shadow-md"
                onClick={() => setLocation('/dashboard/analytics')}
              >
                View Full Analysis
              </Button>
            </div>
          </motion.div>
        )}

        {/* Empty state when no data and no mailbox connected */}
        {showEmptyState && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-16 text-center rounded-2xl border border-dashed border-border/40 bg-muted/10"
          >
            <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <Mail className="h-10 w-10 text-primary/60" />
            </div>
            <h3 className="text-lg font-bold mb-2">No Data Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Connect a mailbox and start your first campaign to see your KPIs, activity feed, and insights here.
            </p>
            <div className="flex gap-3">
              <Button onClick={() => setLocation('/dashboard/integrations')}>
                <Mail className="h-4 w-4 mr-2" /> Connect Mailbox
              </Button>
              <Button variant="outline" onClick={() => setLocation('/dashboard/outreach')}>
                <Send className="h-4 w-4 mr-2" /> Create Campaign
              </Button>
            </div>
          </motion.div>
        )}

        {/* Premium Minimalist 5-Column Horizontal Summary */}
        {!showEmptyState && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-3"
        >
          {summaryMetrics.map((metric: any, index: number) => {
            const Icon = metric.icon;
            return (
              <motion.div
                key={metric.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -2, transition: { type: "spring", stiffness: 300 } }}
                transition={{ delay: index * 0.05, duration: 0.3, ease: "easeOut" }}
                className={cn(
                  "relative overflow-hidden rounded-lg border border-border/40 bg-card/40 backdrop-blur-sm p-4 transition-all",
                  metric.glow || "hover:border-primary/30"
                )}
              >
                <div className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-emerald-500/50 animate-pulse" style={{ animationDuration: '2s' }} />
                <div className="flex items-center gap-2 mb-2">
                  <div className={cn("p-1.5 rounded-md", metric.bgColor, metric.borderColor)}>
                    <Icon className={cn("h-3.5 w-3.5", metric.color)} />
                  </div>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1">
                    {metric.label}
                    {metric.description && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="h-3 w-3 cursor-help text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-[11px] font-medium">
                          {metric.description}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </div>
                <div className="text-xl font-bold text-foreground tabular-nums">
                  {metric.value}
                  <span className="text-sm font-medium text-muted-foreground/60 ml-1">
                    {metric.suffix}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {metric.trend === 'up' && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                  {metric.trend === 'down' && <TrendingDown className="h-3 w-3 text-red-500" />}
                  {metric.percentage !== undefined && metric.percentage !== null && (
                    <span className={cn("text-[9px] font-bold", metric.trend === 'up' ? 'text-emerald-500' : metric.trend === 'down' ? 'text-red-500' : 'text-muted-foreground/50')}>
                      {metric.percentage > 0 ? '+' : ''}{metric.percentage?.toFixed(1)}%
                    </span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
        )}

        {/* Main Content Split */}
        {!showEmptyState && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-5">
            {activities.length > 0 && insightsData?.summary && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-primary/5 border border-primary/20 rounded-lg p-4 relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-[50px] rounded-full group-hover:bg-primary/20 transition-colors" />
                <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-primary mb-2">
                  <Brain className="h-4 w-4" /> Deep Insights
                </h4>
                {cleanInsightSummary ? cleanInsightSummary : ""}
              </motion.div>
            )}
            {activeCampaign && (
              <div className="space-y-4" />
            )}
            <div className="h-[480px]">
              <RecentConversations />
            </div>
            {(statsData?.aiActionLogs?.length ?? 0) > 0 && (
              <div className="mt-6">
                <AutonomousActionFeed logs={statsData?.aiActionLogs || []} />
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Card className="border-border/50 rounded-lg bg-muted/20">
              <CardHeader>
                <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Import Prospects", icon: Users, path: "/dashboard/lead-import" },

                  { label: "Connect Channels", icon: Mail, path: "/dashboard/integrations" },
                ].map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="w-full justify-between h-10 px-3 rounded-lg border-border/40 hover:bg-background transition-all group"
                    onClick={() => setLocation(action.path)}
                  >
                    <span className="flex items-center text-xs font-medium">
                      <action.icon className="h-4 w-4 mr-3 text-muted-foreground group-hover:text-primary transition-colors" />
                      {action.label}
                    </span>
                    <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-40 group-hover:translate-x-1 transition-all" />
                  </Button>
                ))}
              </CardContent>
            </Card>

            <div className="space-y-0.5">
              <ReputationCard 
                score={stats?.health?.score !== undefined ? stats.health.score : null}
                status={(stats?.health?.status || 'healthy') as any}
                bounces={stats?.health?.bounces ?? { hard: 0, soft: 0, spam: 0, total: 0 }}
                dns={stats?.health?.dns}
                isLoading={statsLoading}
                hasIntegrations={isSmtpConnected}
              />
              <ReputationTrendChart />
            </div>

            <Card className="border-border/50 rounded-lg bg-card/40">
              <CardHeader className="pb-3 border-b border-border/10">
                <CardTitle className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-primary/60" />
                  System Status
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-muted/10">
                  <span className="text-xs font-medium text-foreground/80 flex items-center gap-2.5">
                    <div className={cn("h-2 w-2 rounded-full",
                      (stats?.sync?.status === "Autonomous" && stats?.leads !== 0) ? "bg-emerald-500" : "bg-amber-400"
                    )} />
                    AI Engine
                  </span>
                  <Badge variant="outline" className={cn("border-0 text-[9px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-md",
                    stats?.sync?.status === "Autonomous" ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                  )}>
                    {stats?.sync?.status === "Autonomous" ? "Active" : "Standby"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-muted/10">
                  <span className="text-xs font-medium text-foreground/80 flex items-center gap-2.5">
                    <div className={cn("h-2 w-2 rounded-full",
                      isSmtpConnected ? "bg-emerald-500" : "bg-rose-400"
                    )} />
                    Mail Channels
                  </span>
                  <Badge variant="outline" className={cn("border-0 text-[9px] uppercase font-semibold tracking-wider px-2 py-0.5 rounded-md",
                    isSmtpConnected ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
                  )}>
                    {isSmtpConnected ? "Connected" : "Disconnected"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        )}
    </PageWrapper>
  );
}
