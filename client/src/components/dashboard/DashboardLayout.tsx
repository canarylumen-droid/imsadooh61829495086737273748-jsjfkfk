import { useState, useCallback, KeyboardEvent, useEffect } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { TrialExpiredOverlay } from "@/components/TrialExpiredOverlay";
import { InternetConnectionBanner } from "@/components/InternetConnectionBanner";
import { InstallPWAPrompt } from "@/components/InstallPWAPrompt";
import { GuidedTour, useTour } from "@/components/ui/GuidedTour";
import {
  Home,
  Inbox,
  MessageSquare,
  Briefcase,
  Plug,
  BarChart3,
  Settings,
  Shield,
  X,
  Search,
  Bell,
  ChevronDown,
  LogOut,
  Upload,
  Zap,
  BookMarked,
  Activity,
  Sun,
  Moon,
  Globe,
  Lock,
  ChevronRight,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
  CreditCard,
  User,
  Check,
  Sparkles,
  Trash2,
  DollarSign,
  Users,
  ShieldAlert,
  Clock,
  Terminal,
  LifeBuoy
} from "lucide-react";
import { MailboxSwitcher } from "@/components/outreach/MailboxSwitcher";
import { useMailbox } from "@/hooks/use-mailbox";

import { useTheme } from "next-themes";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/ui/Logo";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { BellRing, ShieldCheck, Info } from "lucide-react";
import { useRealtime, RealtimeProvider } from "@/hooks/use-realtime";
import { formatDistanceToNow } from "date-fns";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMutation } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { getPlanCapabilities } from "@shared/plan-utils";

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  adminOnly?: boolean;
  requiresStep?: string;
  badge?: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface UserProfile {
  id: string;
  name?: string;
  email?: string;
  avatar?: string;
  username?: string;
  role?: 'admin' | 'member';
  plan?: string;
  trialExpiresAt?: string;
  calendlyAccessToken?: string;
  calendarLink?: string;
  config?: {
    autonomousMode?: boolean;
    [key: string]: any;
  };
  metadata?: {
    onboardingCompleted?: boolean;
    [key: string]: unknown;
  };
}

interface Notification {
  id: string;
  title: string;
  message: string;
  description?: string;
  isRead: boolean;
  createdAt: string;
  type?: string;
}

interface NotificationsData {
  notifications: Notification[];
  unreadCount: number;
}

const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full w-9 h-9 text-muted-foreground hover:text-foreground transition-colors hover:bg-muted/50"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
};

export function DashboardLayout({ children, fullHeight = false }: { children: React.ReactNode, fullHeight?: boolean }) {
  const { data: user, isLoading: isUserLoading } = useQuery<UserProfile | null>({
    queryKey: ["/api/user/profile"],
  });
  const { selectedMailboxId } = useMailbox();
  const tourState = useTour(user?.metadata?.onboardingCompleted);
  const { showTour, completeTour, skipTour, replayTour } = tourState || {
    showTour: false,
    completeTour: () => { },
    skipTour: () => { },
    replayTour: () => { }
  };
  const [location, setLocation] = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    "Engagement": true,
    "Tools": true,
    "Reports": true
  });
  const [showNotificationsPanel, setShowNotificationsPanel] = useState(false);
  const [showPushPrompt, setShowPushPrompt] = useState(true);

  // Optimistic UI for AI Toggle
  const [localAutonomousMode, setLocalAutonomousMode] = useState<boolean | null>(null);
  const isAutonomousMode = localAutonomousMode !== null ? localAutonomousMode : (user?.config?.autonomousMode !== false);
  
  useEffect(() => {
    // Sync with external updates
    setLocalAutonomousMode(null);
  }, [user?.config?.autonomousMode]);
  const isCalendarConnected = !!(user?.calendlyAccessToken || user?.calendarLink);

  const { data: aiActions } = useQuery<any[]>({
    queryKey: ["/api/dashboard/ai-actions"],
    // refetchInterval: 10000 removed, relying on websocket for updates
  });

  const toggleAutonomousMode = useMutation({
    mutationFn: async (autonomousMode: boolean) => {
      return apiRequest('PATCH', '/api/user/config', { autonomousMode });
    },
    onSuccess: (_, autonomousMode) => {
      queryClient.setQueryData(["/api/user/profile"], (old: any) => ({
        ...old,
        config: { ...old.config, autonomousMode }
      }));
      toast({
        title: `AI Engine ${autonomousMode ? 'Activated' : 'Paused'}`,
        description: `Autonomous mode is now ${autonomousMode ? 'running' : 'stopped'}.`,
      });
    }
  });

  const deleteNotification = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/notifications/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Notification Deleted",
      });
    }
  });

  const [currentAlert, setCurrentAlert] = useState<{ title: string; message: string; type: string } | null>(null);

  const { permission, isSubscribed, subscribe, loading: pushLoading } = usePushNotifications();

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && searchQuery.trim()) {
      // Pass the search query as a URL parameter to deep link or filter the inbox
      setLocation(`/dashboard/inbox?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
      setMobileMenuOpen(false); // Close mobile menu if open
    }
  };





  const navGroups: NavGroup[] = [
    {
      label: "Tools",
      items: [
        { label: "Inbox", icon: Inbox, path: "/dashboard/inbox" },
        { label: "Lead Recovery", icon: LifeBuoy, path: "/dashboard/lead-recovery" },
        { label: "Pending Payments", icon: DollarSign, path: "/dashboard/pending-payments" },
        { label: "Pipeline", icon: Briefcase, path: "/dashboard/deals" },
        { label: "Integrations", icon: Plug, path: "/dashboard/integrations" },
      ],
    },
    {
      label: "Engagement",
      items: [
        { label: "Import Leads", icon: Upload, path: "/dashboard/lead-import" },
        { label: "Objections", icon: Shield, path: "/dashboard/objections" },
        { label: "Custom Knowledge", icon: BookMarked, path: "/dashboard/custom-knowledge" },
      ],
    },
    {
      label: "Reports",
      items: [
        { label: "Transparency Audit Log", icon: Activity, path: "/dashboard/ai-decisions" },
        { label: "Analytics", icon: BarChart3, path: "/dashboard/analytics" },
        { label: "Insights", icon: Sparkles, path: "/dashboard/insights" },
        { label: "Video Automation", icon: Globe, path: "/dashboard/video-automation" },
      ],
    },
  ];

  // Admin-only groups
  if (user?.role === 'admin') {
    const adminSecretPath = 'admin-secret-xyz'; // Constant used in App.tsx
    navGroups.push({
      label: "System",
      items: [
        { label: "Security Sentinel", icon: ShieldAlert, path: `/${adminSecretPath}/security` },
        { label: "Admin Console", icon: Shield, path: `/${adminSecretPath}` },
      ],
    });
  }

  const isFeatureUnlocked = useCallback((_step?: string): boolean => {
    return true;
  }, []);




  const { isConnected, notificationPermission, requestPermission } = useRealtime();

  const { data: notificationsData } = useQuery<NotificationsData | null>({
    queryKey: ["/api/notifications", { integrationId: selectedMailboxId }],
  });

  const { data: dashboardStats } = useQuery<any>({
    queryKey: ["/api/dashboard/stats", { integrationId: selectedMailboxId }],
  });

  const unreadNotifications = notificationsData?.unreadCount || 0;
  const [notifDateFilter, setNotifDateFilter] = useState<'all' | 'today' | 'week'>('all');

  const handleSignOut = async () => {
    try {
      await apiRequest('POST', '/api/auth/signout');
    } catch (e) {
      console.error('Signout request failed', e);
    } finally {
      queryClient.clear();
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/';
    }
  };

  const toggleGroup = useCallback((groupLabel: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  }, []);

  const handleOpenNavigation = useCallback(() => {
    setSidebarCollapsed(false);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      setMobileMenuOpen(true);
    }
  }, []);

  const handleNavigate = useCallback((path: string) => {
    setLocation(path);
    setSidebarCollapsed(true);
    setMobileMenuOpen(false);
  }, [setLocation]);

  const isPathActive = (path: string) => {
    if (path === "/dashboard") return location === "/dashboard";
    return location.startsWith(path);
  };

  const renderNavItem = (item: NavItem, isLocked: boolean = false, forceExpanded: boolean = false) => {
    const Icon = item.icon;
    const isActive = isPathActive(item.path);
    const showLabel = forceExpanded || !sidebarCollapsed;

    if (isLocked) {
      return (
        <div key={item.path} className="px-2 mb-1 opacity-50 cursor-not-allowed group relative">
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg transition-all">
            <Lock className="h-4 w-4 text-muted-foreground" />
            {showLabel && <span className="text-sm font-bold text-muted-foreground">{item.label}</span>}
          </div>
        </div>
      );
    }

    return (
      <div
        key={item.path}
        data-testid={`nav-item-${item.label.toLowerCase()}`}
        onClick={() => handleNavigate(item.path)}
        className={`relative flex items-center gap-3 px-3 py-2 rounded-xl transition-all cursor-pointer group mb-1 hover-bounce ${isActive
          ? "bg-primary/10 text-primary font-bold shadow-sm"
          : "text-muted-foreground hover:bg-white/5 dark:hover:bg-white/10 hover:text-foreground dark:hover:text-white"
          }`}
      >
        <Icon className={`h-4 w-4 transition-colors ${isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
        {showLabel && (
          <span className="text-sm truncate flex-1 font-semibold">
            {item.label}
          </span>
        )}
        {isActive && showLabel && (
          <motion.div layoutId="active-pill" className="absolute right-2 w-1.5 h-1.5 bg-primary rounded-full" />
        )}
      </div>
    );
  };

  if (isUserLoading) {
    return (
      <div className="h-[100dvh] w-screen flex items-center justify-center bg-background">
        <PremiumLoader text="Preparing Workspace..." />
      </div>
    );
  }

  return (
    <RealtimeProvider userId={user?.id}>
      <TooltipProvider delayDuration={400}>
        <div className="flex h-[100dvh] bg-background font-sans text-foreground overflow-hidden relative">
        <InternetConnectionBanner />
        <InstallPWAPrompt />
        <GuidedTour isOpen={showTour} onComplete={completeTour} onSkip={skipTour} />

        {/* Desktop Sidebar (Standard Variant) */}
        <motion.aside
          data-testid="sidebar-desktop"
          className="hidden md:flex flex-col z-50 transition-all duration-500 ease-in-out relative border-r border-border/10 bg-card/60 backdrop-blur-3xl shadow-[4px_0_24px_rgba(0,0,0,0.02)]"
          animate={{ width: sidebarCollapsed ? "4.5rem" : "16rem" }}
        >
          <div className="flex-1 flex flex-col overflow-hidden relative">
            {/* Liquid Glass Accent for Light Mode */}
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent opacity-50 dark:opacity-0 pointer-events-none" />


            {/* Sidebar Header */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-border/40">
              {!sidebarCollapsed ? (
                <Logo className="h-8 w-8" textClassName="text-lg font-bold text-foreground" />
              ) : (
                <div className="w-full flex justify-center">
                  <Logo className="h-7 w-7" textClassName="hidden" />
                </div>
              )}
            </div>

            <div className="absolute top-16 right-3 z-10 -translate-y-1/2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full bg-background border border-border/40 hover:bg-muted text-muted-foreground hover:text-foreground shadow-sm"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </Button>
            </div>


            {/* Navigation */}
            <ScrollArea className="flex-1 px-2 py-4">
              <div className="space-y-5">
                <div>
                  {!sidebarCollapsed && <h4 className="px-3 text-[10px] font-bold text-primary/40 uppercase tracking-[0.16em] mb-2 font-sans flex items-center gap-2">
                    <div className="h-[1px] w-2 bg-primary/20" /> Core
                  </h4>}
                  {renderNavItem({ label: "Overview", icon: Home, path: "/dashboard" })}
                </div>

                {navGroups.map(group => (
                  <div key={group.label} className="space-y-2">
                    {!sidebarCollapsed ? (
                      <button
                        onClick={() => toggleGroup(group.label)}
                        className="flex items-center justify-between w-full px-3 py-1 text-[10px] font-bold text-primary/60 dark:text-primary/40 uppercase tracking-[0.16em] hover:text-foreground dark:hover:text-white transition-colors group font-sans"
                      >
                        <div className="flex items-center gap-2">
                          <div className="h-[1px] w-2 bg-primary/20" />
                          {group.label}
                        </div>
                        <ChevronDown className={`h-3 w-3 transition-transform opacity-30 group-hover:opacity-100 ${expandedGroups[group.label] ? "" : "-rotate-90"}`} />
                      </button>
                    ) : (
                      <div className="h-px bg-white/5 mx-4 my-6" />
                    )}

                    <AnimatePresence initial={false}>
                      {(expandedGroups[group.label] || sidebarCollapsed) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden space-y-1 px-1"
                        >
                          {group.items.map(item => renderNavItem(item, !!(item.requiresStep && !isFeatureUnlocked(item.requiresStep))))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}

                <div className="pt-4 px-1">
                  {sidebarCollapsed && <div className="h-px bg-white/5 mx-4 my-6" />}
                  {renderNavItem({ label: "Settings", icon: Settings, path: "/dashboard/settings" })}
                </div>

                {/* Autonomous Mode Toggle */}
                <div className={`mt-auto px-3 py-4 ${sidebarCollapsed ? "flex justify-center" : ""}`}>
                  <div className={`flex flex-col gap-3 w-full`}>
                    {/* Calendar Status Indicator (New) */}
                    {!sidebarCollapsed && (
                      <div className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-[10px] font-bold uppercase tracking-wider",
                        isCalendarConnected 
                          ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-500" 
                          : "bg-zinc-500/5 border-zinc-500/10 text-zinc-500"
                      )}>
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          isCalendarConnected ? "bg-emerald-500 animate-pulse" : "bg-zinc-500"
                        )} />
                        {isCalendarConnected ? "Calendar Synced" : "Calendar Offline"}
                      </div>
                    )}

                    <div className={`flex items-center justify-between p-2.5 rounded-lg border border-primary/10 bg-primary/5 transition-all hover:bg-primary/10 ${sidebarCollapsed ? "w-10 h-10 p-0 justify-center" : "w-full"}`}>
                      {!sidebarCollapsed && (
                        <div className="flex flex-col gap-0.5">
                          <Label htmlFor="autonomous-mode" className="text-[10px] font-bold uppercase tracking-wider text-primary cursor-pointer flex items-center gap-1.5">
                            AI Engine
                            {isAutonomousMode && (
                              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="Real-time Sync Active" />
                            )}
                          </Label>
                          <span className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
                            {isAutonomousMode ? (
                              <>
                                <Zap className="h-2 w-2 text-emerald-500" />
                                Active Sync
                              </>
                            ) : "System Paused"}
                          </span>
                        </div>
                      )}
                      <div className={sidebarCollapsed ? "scale-75" : ""}>
                          <Switch
                            id="autonomous-mode"
                            checked={isAutonomousMode}
                            onCheckedChange={(checked) => {
                              setLocalAutonomousMode(checked);
                              toggleAutonomousMode.mutate(checked, {
                                onError: () => setLocalAutonomousMode(!checked)
                              });
                            }}
                            disabled={toggleAutonomousMode.isPending}
                            className="data-[state=checked]:bg-primary"
                          />
                      </div>
                    </div>

                    {/* Live AI Activity Feed (Phase 13) */}
                    {!sidebarCollapsed && (
                      <div className="mt-4 px-1">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Live Activity</span>
                          <span className={cn(
                            "flex h-1.5 w-1.5 rounded-full transition-colors",
                            isAutonomousMode ? "bg-primary/40 animate-pulse" : "bg-muted-foreground/20"
                          )} title={isAutonomousMode ? "System processing" : "System standby"} />
                        </div>
                        <div className="space-y-2 max-h-[120px] overflow-hidden mask-fade-bottom">
                          {!isAutonomousMode ? (
                            <div className="py-8 px-2 text-center rounded-xl border border-dashed border-muted-foreground/20 bg-muted/5">
                              <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">Standby</p>
                              <p className="text-[8px] text-muted-foreground/60 leading-tight">AI Engine paused. Manual outreach active.</p>
                            </div>
                          ) : aiActions && aiActions.length > 0 ? (
                            aiActions.slice(0, 3).map((log, i) => (
                              <motion.div 
                                key={log.id} 
                                initial={{ opacity: 0, x: -10 }} 
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.1 }}
                                className="flex flex-col gap-1 p-2 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[9px] font-bold text-foreground/80 truncate max-w-[80px]">{log.leadName || "System"}</span>
                                  <span className={cn(
                                    "text-[8px] font-black uppercase px-1 rounded shadow-sm",
                                    log.decision === 'act' ? "bg-emerald-500/20 text-emerald-500" : "bg-blue-500/20 text-blue-500"
                                  )}>
                                    {log.decision}
                                  </span>
                                </div>
                                <p className="text-[8px] text-muted-foreground leading-tight line-clamp-2">
                                  {log.reasoning || "Analyzing next best action..."}
                                </p>
                              </motion.div>
                            ))
                          ) : (
                            <div className="py-4 text-center">
                              <p className="text-[8px] text-muted-foreground uppercase tracking-widest opacity-30">Listening...</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>

            {/* Sidebar Footer */}
            <div className="p-4 border-t border-border/40 bg-muted/20">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <div className={`flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-muted transition-all group ${sidebarCollapsed ? "justify-center" : ""}`}>
                    <div className="relative">
                      <Avatar className="h-10 w-10 rounded-full border border-border shadow-sm transition-transform group-hover:scale-105">
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback className="rounded-full bg-primary/20 text-primary font-bold text-sm">
                          {(user?.name || "U").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-background" />
                    </div>
                    {!sidebarCollapsed && (
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate text-foreground/90 group-hover:text-foreground">{user?.name || "Member"}</p>
                        <p className="text-[10px] font-bold text-primary/60 uppercase tracking-wider">{user?.plan || "Free"} AI Model</p>
                      </div>
                    )}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={sidebarCollapsed ? "start" : "end"} className="w-72 p-1 rounded-2xl" side={sidebarCollapsed ? "right" : "top"} sideOffset={12}>
                  <div className="p-4 border-b border-border/40 bg-muted/20 rounded-t-xl mb-1">
                    <div className="flex items-center gap-3 mb-4">
                      <Avatar className="h-12 w-12 border-2 border-primary/20 rounded-full">
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold rounded-full">
                          {(user?.name || "U").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-bold text-foreground mb-0.5">{user?.name}</p>
                        <p className="text-[10px] font-bold text-muted-foreground truncate w-40">{user?.email}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80">
                          <span>Leads Processed</span>
                          <span>{dashboardStats?.totalLeads || 0} / {getPlanCapabilities(user?.plan || 'trial').leadsLimit.toLocaleString()}</span>
                        </div>
                        <div className="h-1 w-full bg-muted/50 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(((dashboardStats?.totalLeads || 0) / getPlanCapabilities(user?.plan || 'trial').leadsLimit) * 100, 100)}%` }}
                            className="h-full bg-primary"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => handleNavigate('/dashboard/settings')} className="rounded-xl cursor-pointer py-2.5 font-bold text-xs uppercase tracking-wider">
                      <User className="mr-3 h-4 w-4" />
                      Profile Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleNavigate('/dashboard/pricing')} className="rounded-xl cursor-pointer py-2.5 font-bold text-xs uppercase tracking-wider">
                      <CreditCard className="mr-3 h-4 w-4" />
                      Subscription
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator className="my-1 mx-2" />
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={handleSignOut} className="rounded-xl text-destructive hover:bg-destructive/10 cursor-pointer py-2.5 font-bold text-xs uppercase tracking-wider">
                      <LogOut className="mr-3 h-4 w-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </motion.aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-background relative z-10 transition-all duration-500 overflow-hidden">
          {/* Top Header */}
          <header className="h-14 md:h-16 border-b border-border/10 bg-background/60 backdrop-blur-3xl flex items-center justify-between px-3 md:px-6 sticky top-0 z-40 transition-all duration-300">
            <div className="flex items-center gap-4 flex-1">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 -ml-1 text-foreground/80 hover:bg-primary/10 hover:text-primary rounded-xl w-9 h-9 transition-all border border-border/10"
                onClick={handleOpenNavigation}
                aria-label="Open navigation"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                <SheetContent side="left" className="p-0 w-[85%] sm:w-[380px] bg-background border-r border-border/40 flex flex-col pt-0">
                  <div className="h-24 flex items-center px-8 border-b border-border/40 bg-background text-foreground">
                    <Logo className="h-10 w-10" textClassName="text-2xl font-black tracking-tighter text-foreground" />
                  </div>
                  <ScrollArea className="flex-1 px-4 py-8">
                    <div className="space-y-10">
                      <div>
                        <h4 className="px-6 text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.3em] mb-4">Command Center</h4>
                        <div className="space-y-1">
                          {renderNavItem({ label: "Overview", icon: Home, path: "/dashboard" }, false, true)}
                        </div>
                      </div>
                      {navGroups.map(group => (
                        <div key={group.label} className="space-y-2">
                          <h4 className="px-6 text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.3em] mb-4">{group.label}</h4>
                          <div className="space-y-1">
                            {group.items.map(item => renderNavItem(item, !!(item.requiresStep && !isFeatureUnlocked(item.requiresStep)), true))}
                          </div>
                        </div>
                      ))}
                      <div className="pt-6 border-t border-border/10">
                        {renderNavItem({ label: "Settings", icon: Settings, path: "/dashboard/settings" }, false, true)}
                      </div>
                    </div>
                  </ScrollArea>
                  <div className="p-4 border-t border-border/10 bg-muted/10 space-y-3">
                    <div className="flex items-center gap-4 p-4 rounded-3xl bg-background border border-border/40">
                      <Avatar className="h-12 w-12 rounded-full">
                        <AvatarImage src={user?.avatar} />
                        <AvatarFallback className="font-black bg-primary text-black rounded-full">{(user?.name || "U")[0]}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black truncate">{user?.name || "Member"}</p>
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{user?.plan || "Free"} plan active</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="w-full rounded-2xl border-destructive/20 text-destructive hover:bg-destructive/10 h-12 font-bold"
                      onClick={handleSignOut}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Sign Out
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>

              <div className="relative max-w-lg w-full hidden md:block group">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-all" />
                <Input
                  placeholder="Search leads..."
                  className="h-10 pl-10 bg-muted/40 border-border/10 focus:bg-background focus:ring-2 focus:ring-primary/5 rounded-lg font-semibold text-xs placeholder:text-muted-foreground/40 dark:placeholder:text-white/60 transition-all shadow-inner text-foreground dark:text-white"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                />
                <div className="absolute right-5 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-20 group-focus-within:opacity-100 transition-opacity">
                  <kbd className="hidden sm:inline-flex items-center px-2 py-1 rounded-lg border border-border bg-muted/80 font-mono text-[9px] font-black text-foreground dark:text-white">
                    CTRL K
                  </kbd>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {isConnected && notificationPermission === 'default' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="hidden lg:flex items-center gap-2 px-4 py-2 bg-primary/20 border border-primary/30 rounded-full text-[11px] font-black text-primary cursor-pointer hover:bg-primary/30 transition-all shadow-lg shadow-primary/10 hover:scale-105 active:scale-95 group"
                  onClick={requestPermission}
                >
                  <div className="relative">
                    <BellRing className="h-3.5 w-3.5 animate-pulse" />
                    <div className="absolute inset-0 bg-primary blur-md opacity-50 group-hover:opacity-100 transition-opacity" />
                  </div>
                  ENABLE NOTIFICATIONS
                </motion.div>
              )}

              <MailboxSwitcher className="hidden sm:flex" />
              <ThemeSwitcher />

              {/* Time Saved Widget */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-600 dark:text-emerald-400 cursor-default">
                    <Clock className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-black uppercase tracking-wider">
                      {(() => {
                        const totalSeconds = dashboardStats?.timeSaved || 0;
                        
                        if (totalSeconds < 60) return `${Math.round(totalSeconds)}s Saved`;
                        
                        const savedMinutes = totalSeconds / 60;
                        if (savedMinutes < 60) {
                          const mins = Math.floor(savedMinutes);
                          const secs = Math.round(totalSeconds % 60);
                          return `${mins}m ${secs > 0 ? secs + 's ' : ''}Saved`;
                        }
                        
                        const savedMinutesFloat = totalSeconds / 60;
                        const hours = Math.floor(savedMinutesFloat / 60);
                        const mins = Math.round(savedMinutesFloat % 60);
                        return `${hours}h ${mins > 0 ? mins + 'm ' : ''}Saved`;
                      })()}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px] text-center">
                  <p className="text-xs font-bold mb-1">AI Time Savings</p>
                  <p className="text-[10px] text-muted-foreground">Precision metrics aggregated from {dashboardStats?.aiReplies || 0} AI replies, {dashboardStats?.totalMessages || 0} outreaches, and automated lead intelligence cycles.</p>
                </TooltipContent>
              </Tooltip>

              <Sheet open={showNotificationsPanel} onOpenChange={setShowNotificationsPanel}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/50 transition-all hover:scale-105 active:scale-95">
                    <Bell className="h-5 w-5" />
                    {unreadNotifications > 0 && (
                      <span className="absolute -top-1 -right-1 h-5 min-w-[20px] px-1.5 flex items-center justify-center rounded-full bg-primary text-[10px] font-black text-black border-2 border-background animate-in fade-in zoom-in duration-300">
                        {unreadNotifications > 99 ? '99+' : unreadNotifications}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[450px] p-0 flex flex-col border-l border-border/40 bg-background/95 backdrop-blur-2xl">
                  <div className="p-4 border-b border-border/20 bg-muted/20">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-black uppercase italic">Notifications</h4>
                      {unreadNotifications > 0 && (
                        <Badge className="bg-primary text-black font-black uppercase text-[10px] px-3 py-1">
                          {unreadNotifications} NEW
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground font-medium mb-3">Real-time alerts from your autonomous sales engine.</p>

                    <div className="flex flex-col gap-3">
                      <div className="flex gap-2">
                        {(['all', 'today', 'week'] as const).map(f => (
                          <Button
                            key={f}
                            variant="ghost"
                            size="sm"
                            onClick={() => setNotifDateFilter(f)}
                            className={cn(
                              "h-7 px-4 rounded-full text-[10px] font-bold uppercase tracking-widest transition-all border border-transparent",
                              notifDateFilter === f
                                ? "bg-primary text-black border-primary shadow-[0_0_15px_rgba(var(--primary),0.3)]"
                                : "hover:bg-muted text-muted-foreground border-border/10"
                            )}
                          >
                            {f === 'all' ? 'All' : f === 'today' ? 'Today' : 'Week'}
                          </Button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 text-[10px] font-black uppercase tracking-[0.12em] flex-1 rounded-lg border-primary/20 hover:bg-primary/5 transition-all"
                          onClick={async () => {
                            const queryKey = ["/api/notifications", { integrationId: selectedMailboxId }];
                            queryClient.setQueryData(queryKey, (old: any) => {
                              if (!old) return old;
                              return {
                                ...old,
                                notifications: old.notifications.map((n: any) => ({ ...n, isRead: true })),
                                unreadCount: 0
                              };
                            });
                            try {
                              await apiRequest('POST', '/api/notifications/mark-all-read');
                            } finally {
                              queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
                            }
                          }}
                        >
                          <Check className="w-4 h-4 mr-2 text-primary" />
                          Mark All Read
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 text-[10px] font-black uppercase tracking-[0.12em] flex-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                          onClick={async () => {
                            if (confirm("Permanently delete all notifications?")) {
                              await apiRequest('POST', '/api/notifications/clear-all');
                              queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete All
                        </Button>
                      </div>
                    </div>
                  </div>

                  <ScrollArea className="flex-1 h-[calc(100vh-220px)]">
                    {notificationsData?.notifications && notificationsData.notifications.length > 0 ? (
                      <div className="flex flex-col">
                        {/* Table Header */}
                        <div className="grid grid-cols-[1fr_80px] px-6 py-3 border-b border-border/5 bg-muted/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
                          <span>Message & Detail</span>
                          <span className="text-right">Time</span>
                        </div>

                        {notificationsData.notifications
                          .filter(n => {
                            if (notifDateFilter === 'all') return true;
                            const date = new Date(n.createdAt);
                            const now = new Date();
                            if (notifDateFilter === 'today') {
                              return date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
                            }
                            if (notifDateFilter === 'week') {
                              const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                              return date >= weekAgo;
                            }
                            return true;
                          })
                          .map((notification) => (
                            <div
                              key={notification.id}
                              className={cn(
                                "p-4 border-b border-border/10 transition-all hover:bg-muted/30 group relative",
                                !notification.isRead && "bg-primary/5 border-l-2 border-l-primary"
                              )}
                            >
                              <div className="flex justify-between items-start gap-4 pr-12">
                                <div>
                                  <h5 className="text-[10px] font-black uppercase tracking-widest text-primary mb-2">
                                    {notification.type}
                                    {!notification.isRead && <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                                  </h5>
                                  <p className="text-sm font-bold leading-relaxed">{notification.message || notification.description || notification.title}</p>
                                  <p className="text-[10px] text-muted-foreground mt-3 font-medium flex items-center gap-1.5">
                                    <Activity className="w-3 h-3" />
                                    {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                                  </p>
                                </div>
                                <div className="flex gap-1 absolute top-4 right-4">
                                  {!notification.isRead && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 rounded-xl transition-all bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        const queryKey = ["/api/notifications", { integrationId: selectedMailboxId }];
                                        queryClient.setQueryData(queryKey, (old: any) => {
                                          if (!old) return old;
                                          return {
                                            ...old,
                                            notifications: old.notifications.map((n: any) => 
                                              n.id === notification.id ? { ...n, isRead: true } : n
                                            ),
                                            unreadCount: Math.max(0, old.unreadCount - 1)
                                          };
                                        });
                                        try {
                                          await apiRequest('PATCH', `/api/notifications/${notification.id}/read`, {});
                                        } catch (err) {
                                          console.error("Failed to mark notification as read", err);
                                        } finally {
                                          queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
                                        }
                                      }}
                                    >
                                      <Check className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-xl transition-all bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      deleteNotification.mutate(notification.id);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-[280px] p-6 text-center">
                        <div className="w-14 h-14 rounded-full bg-muted/10 flex items-center justify-center mb-4 text-muted-foreground/20">
                          <Inbox className="h-7 w-7" />
                        </div>
                        <p className="text-sm font-black uppercase tracking-[0.2em] text-foreground dark:text-white">Silence is golden</p>
                        <p className="text-xs font-medium mt-2 text-muted-foreground">No active alerts at this moment.</p>
                      </div>
                    )}
                  </ScrollArea>

                  <div className="p-4 border-t border-border/20 bg-muted/10">
                    <Button
                      variant="ghost"
                      className="w-full h-10 rounded-2xl font-bold uppercase tracking-widest text-[10px] text-muted-foreground hover:bg-muted/20"
                      onClick={() => setShowNotificationsPanel(false)}
                    >
                      Close
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>

              <Separator orientation="vertical" className="h-6 mx-1 bg-border/40" />

              <div className="md:hidden">
                <Avatar className="h-10 w-10 rounded-full border border-border/40">
                  <AvatarImage src={user?.avatar} />
                  <AvatarFallback className="font-bold rounded-full">{(user?.name || "U")[0]}</AvatarFallback>
                </Avatar>
              </div>
            </div>
          </header>

          {/* Page Content */}
          {/* Liquid Glass Background Logic (Light Mode) */}
          <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
            <div className="absolute inset-0 bg-[#f8fafc] dark:bg-[#020617] transition-colors duration-700" />

            {/* Liquid Mesh Overlay */}
            <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none mix-blend-overlay"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />
          </div>

          <div className="relative z-10 flex h-screen overflow-hidden">
            <main className="flex-1 overflow-auto bg-background relative">
              <AnimatePresence>
                {currentAlert && (
                  <motion.div
                    initial={{ height: 0, opacity: 0, y: -20 }}
                    animate={{ height: "auto", opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -20 }}
                    className={cn(
                      "mx-8 mt-4 p-4 rounded-2xl border flex items-center justify-between gap-4 shadow-lg z-30",
                      currentAlert.type === 'billing_issue' ? "bg-destructive/5 border-destructive/20 text-destructive" : "bg-primary/5 border-primary/20 text-primary"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-xl", currentAlert.type === 'billing_issue' ? "bg-destructive/20" : "bg-primary/20")}>
                        {currentAlert.type === 'billing_issue' ? <ShieldCheck className="h-5 w-5" /> : <Info className="h-5 w-5" />}
                      </div>
                      <div>
                        <h5 className="font-bold text-sm">{currentAlert.title}</h5>
                        <p className="text-xs opacity-80">{currentAlert.message}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-xl opacity-50 hover:opacity-100" onClick={() => setCurrentAlert(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className={cn("mx-auto", !fullHeight && "max-w-7xl p-3 md:p-5 lg:p-6", fullHeight && "h-full")}>
                {children}
              </div>
            </main>
          </div>
        </div>
      </div>
      {/* Notification Permission Slide-in */}
      <AnimatePresence>
        {permission === 'default' && showPushPrompt && (
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            className="fixed bottom-4 right-20 z-[100] w-72 p-4 bg-background/80 backdrop-blur-xl border border-primary/20 rounded-xl shadow-xl overflow-hidden group"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                  <BellRing className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-black uppercase tracking-tight text-foreground line-height-1">Stay Synchronized</h4>
                  <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Real-time alerts</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground font-medium mb-6 leading-relaxed">
                Enable desktop notifications to receive immediate intelligence on lead conversions and meeting confirmations.
              </p>

              <div className="flex gap-2">
                <Button
                  onClick={subscribe}
                  disabled={pushLoading}
                  className="flex-1 h-10 rounded-xl bg-primary text-black font-black text-[10px] uppercase tracking-widest hover:bg-primary/90"
                >
                  {pushLoading ? "Enabling..." : "Enable Alerts"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowPushPrompt(false)}
                  className="px-4 h-10 rounded-xl text-muted-foreground font-bold text-[9px] uppercase tracking-widest hover:bg-muted/50"
                >
                  Later
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </TooltipProvider>
    </RealtimeProvider>
  );
}
