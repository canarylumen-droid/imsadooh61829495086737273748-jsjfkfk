
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Minus,
  DollarSign,
  TrendingUp,
  Users,
  MessageSquare,
  Zap,
  Mail,
  ArrowUp,
  Download,
  ShieldCheck,
  AlertCircle,
  Activity,
  RefreshCw,
  Sparkles,
  ArrowDown,
  Send
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useReducedMotion } from "@/lib/animation-utils";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { WelcomeCelebration } from "@/components/WelcomeCelebration";
import { useState, useEffect } from "react";
import { PremiumLoader } from "@/components/ui/premium-loader";

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
  metadata?: {
    onboardingCompleted?: boolean;
    [key: string]: unknown;
  };
}

interface DashboardStats {
  leads: number;
  messages: number;
  aiReplies: number;
  conversionRate: number | string;
  conversions: number;
  totalLeads?: number;
  newLeads?: number;
  activeLeads?: number;
  convertedLeads?: number;
  totalMessages?: number;
  hardenedLeads?: number;
  bouncyLeads?: number;
  recoveredLeads?: number;
  lastSync?: string | null;
  engineStatus?: string;
  domainHealth?: number;
}

interface PreviousDashboardStats {
  leads: number;
  messages: number;
  aiReplies: number;
  conversions: number;
  totalLeads?: number;
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
  const prefersReducedMotion = useReducedMotion();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showWelcomeCelebration, setShowWelcomeCelebration] = useState(false);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  // Fetch real user profile
  const { data: user } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    retry: false,
  });

  useEffect(() => {
    if (user) {
      const hasCompletedOnboarding = user.metadata?.onboardingCompleted || false;
      const onboardingDismissedKey = `onboarding_dismissed_${user.id}`;
      const wasOnboardingDismissed = localStorage.getItem(onboardingDismissedKey);
      setShowOnboarding(!hasCompletedOnboarding && !wasOnboardingDismissed);
    }
  }, [user]);

  const showCelebrationAfterOnboarding = () => {
    if (user?.username) {
      const celebrationKey = `celebration_shown_${user.id}`;
      const hasSeenCelebration = localStorage.getItem(celebrationKey);
      const onboardingDismissedKey = `onboarding_dismissed_${user.id}`;
      if (!hasSeenCelebration && localStorage.getItem(onboardingDismissedKey)) {
        setShowWelcomeCelebration(true);
        localStorage.setItem(celebrationKey, "true");
      }
    }
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    if (user?.id) localStorage.setItem(`onboarding_dismissed_${user.id}`, "true");
    queryClient.invalidateQueries({ queryKey: ["/api/user/profile"] });
    showCelebrationAfterOnboarding();
  };

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    staleTime: 30000, // Use cache but trust socket invalidation
  });

  const { data: previousStats } = useQuery<PreviousDashboardStats>({
    queryKey: ["/api/dashboard/stats/previous"],
    retry: false,
    staleTime: 300000,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery<DashboardActivityResponse>({
    queryKey: ["/api/dashboard/activity"],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30000,
  });

  const getTrialDaysLeft = () => {
    if (!user?.plan || user.plan !== "trial" || !user?.trialExpiresAt) return 0;
    const now = new Date();
    const expiryDate = new Date(user.trialExpiresAt);
    const daysLeft = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, daysLeft);
  };

  const trialDaysLeft = getTrialDaysLeft();
  const activities = activityData?.activities || [];

  const formatTimeAgo = (date: string | Date) => {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const calculatePercentageChange = (current: number, previous: number | undefined): string => {
    if (!previousStats || previous === undefined) return "—";
    if (previous === 0) return current > 0 ? "+100%" : "—";
    const change = ((current - previous) / previous) * 100;
    if (isNaN(change) || !isFinite(change)) return "—";
    const formatted = change.toFixed(1);
    return change > 0 ? `+${formatted}%` : `${formatted}%`;
  };

  const kpis = [
    {
      label: "TOTAL LEADS",
      value: stats?.totalLeads || 0,
      icon: Users,
      percentage: calculatePercentageChange(stats?.totalLeads || 0, previousStats?.totalLeads),
      trend: previousStats ? ((stats?.totalLeads || 0) > (previousStats?.totalLeads || 0) ? "up" : (stats?.totalLeads || 0) < (previousStats?.totalLeads || 0) ? "down" : "neutral") : "neutral",
      color: "text-primary",
      glow: "group-hover:shadow-[0_0_20px_rgba(var(--primary),0.15)]"
    },
    {
      label: "LEADS SENT",
      value: stats?.totalMessages || 0,
      icon: Send,
      percentage: calculatePercentageChange(stats?.totalMessages || 0, previousStats?.messages),
      trend: previousStats ? ((stats?.totalMessages || 0) > (previousStats?.messages || 0) ? "up" : (stats?.totalMessages || 0) < (previousStats?.messages || 0) ? "down" : "neutral") : "neutral",
      color: "text-indigo-500",
      glow: "group-hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]"
    },
    {
      label: "REPLIES",
      value: stats?.convertedLeads || 0,
      icon: Zap,
      percentage: calculatePercentageChange(stats?.convertedLeads || 0, previousStats?.convertedLeads),
      trend: previousStats ? ((stats?.convertedLeads || 0) > (previousStats?.convertedLeads || 0) ? "up" : (stats?.convertedLeads || 0) < (previousStats?.convertedLeads || 0) ? "down" : "neutral") : "neutral",
      color: "text-amber-500",
      glow: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]"
    },
    {
      label: "PIPELINE VALUE",
      value: `$${(stats as any)?.pipelineValue?.toLocaleString() || "0"}`,
      icon: DollarSign,
      percentage: "—",
      trend: "neutral",
      color: "text-emerald-500",
      glow: "group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]"
    },
  ];

  if (statsLoading) {
    return <div className="h-[60vh] flex items-center justify-center"><PremiumLoader text="Updating Dashboard..." /></div>;
  }

  const hasAnyActivity = stats && (stats.leads > 0 || stats.messages > 0 || stats.aiReplies > 0);

  return (
    <>
      <AnimatePresence>
        {showWelcomeCelebration && user?.username && (
          <WelcomeCelebration
            username={user.username}
            onComplete={() => setShowWelcomeCelebration(false)}
          />
        )}
      </AnimatePresence>

      <OnboardingWizard isOpen={showOnboarding} onComplete={handleOnboardingComplete} />

      <div className="space-y-8 animate-in fade-in duration-700">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-border/20">
          <div className="space-y-1">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tighter bg-gradient-to-br from-foreground via-foreground/90 to-primary/80 bg-clip-text text-transparent">
              Welcome back, {user?.name?.split(' ')[0] || user?.username || 'User'}
            </h1>
            <p className="text-muted-foreground/80 text-lg font-medium tracking-tight">
              {hasAnyActivity ? "Your outreach system is performing optimally." : "Scale your outreach with personalized AI automation."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-2xl border-border/40 hover:bg-muted/50 transition-all font-bold uppercase tracking-wider text-[10px] h-10 px-6 backdrop-blur-md"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
                queryClient.invalidateQueries({ queryKey: ["/api/dashboard/activity"] });
              }}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh Data
            </Button>
            {stats?.lastSync && (
              <Badge variant="outline" className="px-4 py-2 bg-muted/30 text-muted-foreground border-border/40 rounded-2xl font-bold text-xs">
                <RefreshCw className="w-3 h-3 mr-2 opacity-50" />
                Synced {formatTimeAgo(stats.lastSync)}
              </Badge>
            )}
            {trialDaysLeft > 0 && (
              <Badge variant="outline" className="px-6 py-2 bg-primary/5 text-primary border-primary/20 rounded-2xl font-bold text-xs shadow-sm shadow-primary/5">
                <Sparkles className="w-4 h-4 mr-2" />
                {trialDaysLeft} DAYS REMAINING
              </Badge>
            )}
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {kpis.map((kpi, index) => {
            const Icon = kpi.icon;
            const TrendIcon = kpi.trend === "up" ? ArrowUp : kpi.trend === "down" ? ArrowDown : Minus;
            return (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1, duration: 0.5, ease: "easeOut" }}
              >
                <Card className={cn(
                  "relative transition-all duration-500 border-border/40 rounded-[2.5rem] overflow-hidden group bg-card/40 backdrop-blur-2xl hover:border-primary/30 h-full",
                  kpi.glow
                )}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/50 truncate pr-2">{kpi.label}</CardTitle>
                    <div className={cn("p-2 rounded-2xl transition-colors bg-muted/5 group-hover:bg-muted/10 shrink-0", kpi.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-col h-[calc(100%-60px)]">
                    <div className="text-3xl font-extrabold tracking-tighter mb-2 truncate">{kpi.value}{kpi.suffix || ''}</div>
                    {kpi.percentage !== "—" && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold flex items-center px-2 py-0.5 rounded-full shrink-0 ${kpi.trend === "up" ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}>
                          <TrendIcon className="h-3 w-3 mr-0.5" />
                          {kpi.percentage}
                        </span>
                        <span className="text-[9px] font-bold text-muted-foreground/30 uppercase tracking-widest truncate">Growth</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-auto pt-4 opacity-0 group-hover:opacity-100 transition-all transform translate-y-3 group-hover:translate-y-0 duration-300">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-[9px] font-bold uppercase tracking-widest p-0 px-3 rounded-full hover:bg-primary/5 text-primary truncate max-w-[120px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.location.href = '/api/bulk/export';
                        }}
                      >
                        <Download className="h-3 w-3 mr-1.5 shrink-0" /> Export
                      </Button>
                      <div className="h-8 w-8 rounded-full bg-primary/5 flex items-center justify-center text-primary group-hover:bg-primary/10 transition-colors shrink-0 ml-2">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>

                    {/* Sophisticated Backdrop Glow */}
                    <div className={cn(
                      "absolute -bottom-16 -right-16 w-32 h-32 blur-[80px] opacity-10 group-hover:opacity-20 transition-opacity rounded-full",
                      kpi.color.replace('text-', 'bg-')
                    )} />
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Main Content Split */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Activity Feed */}
          <div className="lg:col-span-2">
            <Card className="rounded-2xl border-border/50 h-full">
              <CardHeader className="border-b border-border/40">
                <CardTitle className="text-lg font-semibold flex items-center gap-3">
                  <Activity className="h-5 w-5 text-primary" />
                  Live Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {activityLoading ? (
                  <div className="p-12 flex justify-center"><PremiumLoader text="Loading stream..." /></div>
                ) : activities.length > 0 ? (
                  <div className="divide-y divide-border/30">
                    {activities.map((activity, i) => (
                      <div key={activity.id} className="p-6 flex gap-6 hover:bg-muted/20 transition-colors">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary mt-1">
                          {activity.type === 'message' ? <MessageSquare className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-start mb-1">
                            <p className="font-medium text-sm text-foreground truncate">{activity.title || "Activity Event"}</p>
                            <span className="text-[11px] text-muted-foreground shrink-0 ml-4 font-medium">{formatTimeAgo(activity.time)}</span>
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">{activity.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                    <Activity className="h-12 w-12 text-muted-foreground/20" />
                    <div className="space-y-1">
                      <p className="font-bold text-lg text-muted-foreground/60">Your lead insights will appear here</p>
                      <p className="text-sm text-muted-foreground px-8 max-w-sm">Connect your channels to start tracking real-time activity.</p>
                    </div>
                    <Button
                      variant="outline"
                      className="rounded-full px-6"
                      onClick={() => setLocation('/dashboard/integrations')}
                    >
                      Connect Integration
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions / Getting Started */}
          <div className="space-y-6">
            <Card className="border-border/50 rounded-2xl bg-muted/20">
              <CardHeader>
                <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Find Prospects", icon: Users, path: "/dashboard/prospecting" },
                  { label: "Create Automation", icon: Zap, path: "/dashboard/video-automation" },
                  { label: "Connect Channels", icon: Mail, path: "/dashboard/integrations" },
                ].map((action) => (
                  <Button
                    key={action.label}
                    variant="outline"
                    className="w-full justify-between h-12 px-4 rounded-xl border-border/40 hover:bg-background transition-all group"
                    onClick={() => setLocation(action.path)}
                  >
                    <span className="flex items-center text-sm font-medium">
                      <action.icon className="h-4 w-4 mr-3 text-muted-foreground group-hover:text-primary transition-colors" />
                      {action.label}
                    </span>
                    <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-40 group-hover:translate-x-1 transition-all" />
                  </Button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border/50 rounded-2xl bg-card/40 backdrop-blur-xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-10 bg-primary rounded-full transition-opacity group-hover:opacity-20" />
              <CardHeader className="pb-3 border-b border-border/10">
                <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                  <ShieldCheck className="h-3 w-3" />
                  Deliverability Status
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest leading-none">Sender Reputation</p>
                    <p className="text-xl font-black text-emerald-400 tracking-tighter">
                      {stats?.domainHealth !== undefined ? stats.domainHealth.toFixed(1) : "100.0"}%
                    </p>
                  </div>
                  <Badge className={cn(
                    "border-0 text-[8px] font-black uppercase tracking-widest",
                    (stats?.domainHealth || 100) > 95 ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                  )}>
                    {(stats?.domainHealth || 100) > 95 ? "Excellent" : "Fair"}
                  </Badge>
                </div>

                {/* Real-time Advisory */}
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/10">
                  <p className="text-[9px] font-bold text-primary uppercase mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    Reputation Advisory
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {(stats?.domainHealth || 100) < 90
                      ? "Bounce rate increasing. Pause outreach and verify your lead list to avoid domain blacklisting."
                      : "Your sender reputation is high. Continue 1-by-1 sending to maintain optimal deliverability."}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest leading-none">AI Deliverability Fixes</p>
                    <p className="text-xl font-black text-cyan-400 tracking-tighter">{stats?.recoveredLeads || 0}</p>
                  </div>
                  <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[8px] font-black uppercase tracking-widest">Fixed</Badge>
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest leading-none">Bounce Mitigation</p>
                    <p className="text-xl font-black text-red-400 tracking-tighter">{stats?.bouncyLeads || 0}</p>
                  </div>
                  <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[8px] font-black uppercase tracking-widest">Filtered</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/50 rounded-2xl">
              <CardHeader className="pb-3 border-b border-border/40">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">System Health</CardTitle>
              </CardHeader>
              <CardContent className="pt-6 space-y-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-3">
                    <div className={cn("h-2 w-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.4)]",
                      stats?.engineStatus === "Autonomous" ? "bg-emerald-500 shadow-emerald-500/40" : "bg-amber-500 shadow-amber-500/40"
                    )} />
                    AI Automation
                  </span>
                  <Badge variant="secondary" className={cn("border-0 text-[10px] uppercase font-bold tracking-tighter",
                    stats?.engineStatus === "Autonomous" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                  )}>
                    {stats?.engineStatus || "Paused"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                    Deliverability Guard
                  </span>
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-0 text-[10px] uppercase font-bold tracking-tighter">Active</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
