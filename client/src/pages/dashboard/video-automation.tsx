
import { useState, useEffect, useCallback } from "react";
import { CustomContextMenu, useContextMenu } from "@/components/ui/interactive/CustomContextMenu";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useCanAccessVideoAutomation } from "@/hooks/use-access-gate";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Activity,
  Trash2,
  Save,
  Edit2,
  Zap,
  Instagram,
  RefreshCw,
  Filter,
  Play,
  Pause,
  Link as LinkIcon,
  Search,
  Brain,
  Sparkles,
  Loader,
  Plus,
  ChevronRight,
  TrendingUp,
  ChevronLeft
} from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface VideoMonitorStats {
  commentsChecked: number;
  dmsSent: number;
  conversions: number;
  followRequests: number;
  hotLeads: number;
  warmLeads: number;
  replied: number;
}

interface VideoMonitor {
  id: string;
  userId: string;
  videoId: string;
  videoUrl: string;
  productLink: string | null;
  ctaText: string;
  isActive: boolean;
  autoReplyEnabled: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lastSync?: string | null;
  stats?: VideoMonitorStats;
}

interface IntentAnalysisResult {
  intent: {
    intentType: string;
    confidence: number;
    shouldDM: boolean;
    hasBuyingIntent: boolean;
    detectedInterest?: string;
  } | null;
  recommendation: string;
}

interface CreateMonitorPayload {
  videoUrl: string;
  ctaLink: string;
  customMessage?: string;
  followUpConfig: {
    askFollowOnConvert: boolean;
    askFollowOnDecline: boolean;
  };
}

// Countdown timer hook
function useCountdown(targetDate: Date | null) {
  const [timeLeft, setTimeLeft] = useState<{
    minutes: number;
    seconds: number;
    total: number;
  }>({ minutes: 0, seconds: 0, total: 0 });

  useEffect(() => {
    if (!targetDate) return;
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const target = new Date(targetDate).getTime();
      const difference = target - now;

      if (difference <= 0) {
        setTimeLeft({ minutes: 0, seconds: 0, total: 0 });
        clearInterval(interval);
        return;
      }

      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeLeft({ minutes, seconds, total: difference });
    }, 1000);

    return () => clearInterval(interval);
  }, [targetDate]);

  return timeLeft;
}

// Intent Detection Demo Component
function IntentDetectionDemo() {
  const [testComment, setTestComment] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<IntentAnalysisResult | null>(null);
  const { toast } = useToast();

  const demoComments = [
    { text: "This is cool! 🔥", type: "high_interest", lang: "EN" },
    { text: "How much does this cost?", type: "price_question", lang: "EN" },
    { text: "¿Cuánto cuesta esto?", type: "price_question", lang: "ES" },
  ];

  const analyzeComment = async (comment: string) => {
    setAnalyzing(true);
    try {
      const response = await apiRequest("POST", "/api/video/test-intent", { comment, videoContext: "Product video" });
      const data = await response.json();
      setResult(data);
    } catch (error) {
      toast({ title: "Failed to analyze", variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <Card className="border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden group relative">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-fuchsia-500/10 text-fuchsia-500 shadow-inner group-hover:scale-110 transition-transform">
            <Brain className="h-6 w-6" />
          </div>
          <div>
            <CardTitle className="text-lg font-bold tracking-tight">Intelligence Intent Engine</CardTitle>
            <CardDescription className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
              AI buying signal analysis
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {demoComments.map((demo, idx) => (
              <Badge
                key={idx}
                variant="outline"
                className="cursor-pointer hover:bg-muted transition-colors font-normal text-xs py-1"
                onClick={() => {
                  setTestComment(demo.text);
                  analyzeComment(demo.text);
                }}
              >
                {demo.text}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Type a test comment..."
            value={testComment}
            onChange={(e) => setTestComment(e.target.value)}
            className="bg-background/40 border-border/40 shadow-none h-11 rounded-xl"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && testComment.trim()) analyzeComment(testComment);
            }}
          />
          <Button
            onClick={() => analyzeComment(testComment)}
            disabled={!testComment.trim() || analyzing}
            className="min-w-[100px] bg-primary hover:bg-primary/90 text-primary-foreground font-bold rounded-xl shadow-lg h-11"
          >
            {analyzing ? <Loader className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {analyzing ? "" : "Analyze"}
          </Button>
        </div>

        {/* Glow effect */}
        <div className="absolute -bottom-10 -right-10 w-32 h-32 blur-[80px] opacity-10 bg-fuchsia-500 rounded-full" />

        <AnimatePresence mode="wait">
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-2xl bg-background/60 border border-border/40 p-5 space-y-4 shadow-xl backdrop-blur-md"
            >
              <div className="flex items-center justify-between">
                <Badge variant={result.intent?.shouldDM ? "default" : "secondary"} className={result.intent?.shouldDM ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-3" : ""}>
                  {result.intent?.shouldDM ? "HIGH INTENT LEAD" : "PASSIVE SIGNAL"}
                </Badge>
                <span className="text-[10px] font-bold tracking-widest text-muted-foreground/50">CONFIDENCE: {Math.round((result.intent?.confidence || 0) * 100)}%</span>
              </div>
              <p className="text-sm font-bold text-foreground leading-snug">{result.recommendation}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

// Monitor Card Component
function MonitorCard({ monitor, nextSync, onToggle, onDelete, isToggling, isDeleting }: {
  monitor: VideoMonitor;
  nextSync: Date | null;
  onToggle: () => void;
  onDelete: () => void;
  isToggling: boolean;
  isDeleting: boolean;
}) {
  const { toast } = useToast();
  const [isEditingLink, setIsEditingLink] = useState(false);
  const [ctaLink, setCtaLink] = useState(monitor.productLink || "");
  const timeLeft = useCountdown(nextSync);
  const syncProgress = nextSync ? Math.max(0, 100 - (timeLeft.total / 30000) * 100) : 0;

  const updateLinkMutation = useMutation({
    mutationFn: async (newLink: string) => {
      return apiRequest("PATCH", `/api/video/monitors/${monitor.id}`, { productLink: newLink });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/video/monitors"] });
      toast({ title: "Link updated", description: "Changes apply immediately" });
      setIsEditingLink(false);
    },
  });

  return (
    <Card className="group hover:border-primary/20 transition-all duration-500 border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden relative">
      <CardHeader className="pb-3 px-6 pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <Badge variant={monitor.isActive ? "default" : "secondary"} className={monitor.isActive ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-bold text-[10px] tracking-wider px-3" : ""}>
                {monitor.isActive ? "LIVE SCANNING" : "MONITOR PAUSED"}
              </Badge>
            </div>
            <a href={monitor.videoUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-semibold text-muted-foreground/40 hover:text-primary truncate block uppercase tracking-[0.1em] transition-colors">
              Source URL ↗
            </a>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-muted/20 hover:bg-muted/40" onClick={onToggle} disabled={isToggling}>
              {monitor.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-destructive/5 hover:bg-destructive/10 text-destructive/70 hover:text-destructive" onClick={onDelete} disabled={isDeleting}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-4 py-4 border-y border-border/20">
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight">{monitor.stats?.commentsChecked || 0}</div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50 mt-1">Found</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight text-primary">{monitor.stats?.dmsSent || 0}</div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50 mt-1">Relays</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold tracking-tight text-emerald-500">{monitor.stats?.conversions || 0}</div>
            <div className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground/50 mt-1">Impact</div>
          </div>
        </div>

        {/* Sync Status */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30">
            <span className="flex items-center gap-1.5"><Activity className="h-3 w-3 animate-pulse" /> Sync Cycle</span>
            <span>{String(timeLeft.minutes).padStart(2, '0')}:{String(timeLeft.seconds).padStart(2, '0')}</span>
          </div>
          <div className="h-1 w-full bg-muted/20 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary"
              initial={{ width: 0 }}
              animate={{ width: `${syncProgress}%` }}
              transition={{ duration: 1 }}
            />
          </div>
        </div>

        {/* Subtle Glow */}
        <div className="absolute -bottom-10 -left-10 w-32 h-32 blur-[80px] opacity-10 bg-primary rounded-full transition-opacity group-hover:opacity-20" />
      </CardContent>
    </Card>
  );
}

export default function VideoAutomationPage() {
  const { toast } = useToast();
  const { canAccess: canAccessVideo } = useCanAccessVideoAutomation();
  const [videoUrl, setVideoUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;
  const [mounted, setMounted] = useState(false);
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: monitors, isLoading: monitorsLoading } = useQuery<VideoMonitor[]>({
    queryKey: ["/api/video-automation/monitors"],
    select: (data: any) => Array.isArray(data) ? data : (data?.monitors ?? []),
  });

  const { data: instagramMedia, isLoading: reelsLoading } = useQuery({
    queryKey: ["/api/dashboard/instagram/media"],
    enabled: canAccessVideo,
  });

  const { contextConfig, handleContextMenu, closeMenu } = useContextMenu();

  // Map backend media to the format expected by the UI
  const instagramReels = {
    reels: Array.isArray((instagramMedia as any)?.media)
      ? (instagramMedia as any).media.map((item: any) => ({
        id: item.id,
        url: item.permalink,
        mediaUrl: item.media_url,
        thumbnailUrl: item.thumbnail_url || item.media_url,
        caption: item.caption || '',
        timestamp: item.timestamp,
      }))
      : []
  };

  const createMonitor = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/video-automation/monitors", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/video-automation/monitors"] });
      toast({ title: "Monitor activated", description: "Intelligence Memory is now watching this post" });
      setVideoUrl("");
    },
    onError: () => toast({ title: "Failed to create monitor", variant: "destructive" }),
  });

  const toggleMonitor = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `/api/video-automation/monitors/${id}`, { isActive });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/video-automation/monitors"] }),
  });

  const deleteMonitor = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/video-automation/monitors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/video-automation/monitors"] });
      toast({ title: "Monitor removed" });
    },
  });

  const handleMenuAction = useCallback((action: string, data: any) => {
    switch (action) {
      case 'automate_video':
        createMonitor.mutate({
          videoId: data.id,
          videoUrl: data.url,
          productLink: "https://supermemory.ai/demo",
          ctaText: "Get Started",
        });
        break;
      case 'copy_link':
        toast({ title: "Link Copied", description: "Video URL saved to clipboard" });
        break;
      case 'save_thumbnail':
        window.open(data.thumbnailUrl, '_blank');
        break;
    }
  }, [createMonitor, toast]);

  // Filter and Pagination Logic
  const filteredReels = instagramReels?.reels?.filter((reel: any) =>
    !searchQuery || reel.caption?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const totalPages = Math.ceil(filteredReels.length / itemsPerPage);
  const currentReels = filteredReels.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const ReelsSkeleton = () => (
    <ResponsiveGrid className="grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 animate-in fade-in duration-700">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="aspect-[9/16] rounded-xl overflow-hidden relative border border-white/5 bg-muted/5 group">
          {/* Top gradient */}
          <div className="absolute top-0 inset-x-0 h-20 bg-gradient-to-b from-black/20 to-transparent" />

          {/* Central Spinner */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader className="w-8 h-8 text-primary/20 animate-spin" />
          </div>

          {/* Bottom bar skeleton */}
          <div className="absolute bottom-0 inset-x-0 p-3 space-y-2 bg-gradient-to-t from-black/80 to-transparent">
            <Skeleton className="h-3 w-3/4 bg-white/10" />
            <Skeleton className="h-2 w-1/2 bg-white/5" />
          </div>
        </div>
      ))}
    </ResponsiveGrid>
  );

  const selectedMonitor = useMemo(() => {
    return monitors?.find(mon => mon.id === selectedMonitorId);
  }, [monitors, selectedMonitorId]);

  return (
    <PageWrapper className="slide-in-from-bottom-4 duration-700 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">Video Intelligence Workflow</h2>
          <p className="text-muted-foreground font-medium max-w-lg">Transform Instagram Reels into conversion engines. Monitor engagement pulse and trigger AI outreach instantly.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-muted/50 rounded-xl p-1 border border-border/50 shadow-inner">
            <Button variant="ghost" className="h-9 px-4 text-xs font-semibold uppercase tracking-wider bg-background shadow-sm rounded-lg border border-border/20">Performance</Button>
            <Button variant="ghost" className="h-9 px-4 text-xs font-semibold uppercase tracking-wider opacity-40">Configuration</Button>
          </div>
          <Button
            variant="outline"
            className="rounded-xl border-border/40 hover:bg-muted/50 h-11 px-4 text-xs font-semibold uppercase tracking-wider"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/dashboard/instagram/media"] });
              toast({ title: "Syncing...", description: "Fetching latest Instagram media" });
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Sync
          </Button>
        </div>
      </div>

      <ResponsiveGrid className="grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Column: Active Monitors List */}
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-card border-border/40 rounded-2xl overflow-hidden group border-b-4 border-b-primary/20">
            <CardHeader className="p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Active Workflow</h3>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
              </div>
              <p className="text-2xl font-bold">{monitors?.length || 0}</p>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mt-1">Monitored Media Units</p>
            </CardHeader>
          </Card>

          <div className="space-y-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 px-4">Monitoring Workflows</h3>
            <ScrollArea className="h-[400px] -mx-1 px-1">
              <div className="space-y-3">
                {monitorsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-2xl bg-muted/10" />
                  ))
                ) : monitors?.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4 text-center rounded-2xl border border-dashed border-border/40 bg-muted/5 backdrop-blur-sm opacity-40">
                    <Zap className="h-8 w-8 mb-4" />
                    <p className="text-xs font-bold uppercase tracking-wider leading-relaxed">
                      No active monitors.
                    </p>
                  </div>
                ) : (
                  monitors?.map((mon) => (
                    <motion.div
                      key={mon.id}
                      whileHover={{ scale: 1.02, x: 5 }}
                      className={cn(
                        "p-4 rounded-2xl border transition-all cursor-pointer group",
                        selectedMonitorId === mon.id
                          ? "bg-primary/5 border-primary/40 shadow-sm"
                          : "bg-muted/30 border-border/40 hover:bg-muted/50"
                      )}
                      onClick={() => setSelectedMonitorId(mon.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-background border border-border flex items-center justify-center overflow-hidden shrink-0">
                          {mon.metadata?.thumbnail_url ? (
                            <img src={mon.metadata.thumbnail_url as string} alt="Thumbnail" className="w-full h-full object-cover" />
                          ) : (
                            <Play className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{mon.ctaText || "Untitled Workflow"}</p>
                          <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
                            {mon.isActive ? 'Watching' : 'Paused'}
                          </p>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <Button
            className="w-full h-11 rounded-xl font-bold uppercase tracking-wider text-xs gap-2 shadow-md shadow-primary/10 hover:shadow-primary/20 active:scale-98 transition-all bg-primary text-primary-foreground"
            onClick={() => {
              toast({ title: "Provisioning Monitor", description: "Select a reel from your feed below." });
            }}
          >
            <Plus className="w-4 h-4" /> Deploy New Monitor
          </Button>
        </div>

        {/* Right Column: Video Analysis and Reels Grid */}
        <div className="lg:col-span-3 space-y-12">
          {/* Main Stage (Selected Monitor Analysis) */}
          <AnimatePresence mode="wait">
            {selectedMonitorId ? (
              <motion.div
                key="analysis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 xl:grid-cols-5 gap-8">
                  <div className="xl:col-span-2">
                    <div className="aspect-[9/16] bg-black rounded-2xl border-4 border-card shadow-2xl overflow-hidden relative group">
                      {selectedMonitor?.videoUrl ? (
                        <video
                          src={selectedMonitor.videoUrl}
                          className="w-full h-full object-cover"
                          controls
                          onContextMenu={(e) => handleContextMenu(e, 'video', selectedMonitor)}
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-4 text-muted-foreground/20">
                          <Play className="w-20 h-20" />
                        </div>
                      )}
                      <div className="absolute top-6 left-6">
                        <Badge className="bg-emerald-500/20 text-emerald-500 border-emerald-500/40 font-semibold text-[10px] tracking-wider">
                          LIVE ANALYSIS
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="xl:col-span-3 space-y-8">
                    <div className="p-6 rounded-2xl bg-card border border-border/40 shadow-sm relative overflow-hidden group glass-premium">
                      <div className="relative z-10">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-primary mb-3">Intelligence Analytics</h3>
                        <h2 className="text-xl font-bold tracking-tight mb-4 truncate">{selectedMonitor?.videoUrl ? "Active Media Monitor" : "Select Monitor"}</h2>
                        <div className="grid grid-cols-2 gap-4 mb-8">
                          <div className="p-5 rounded-2xl bg-muted/40 border border-border/60">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">Intent Accuracy</p>
                            <div className="flex items-end gap-2 text-xl font-bold">84% <TrendingUp className="w-4 h-4 text-emerald-500 mb-1" /></div>
                          </div>
                          <div className="p-5 rounded-2xl bg-muted/40 border border-border/60">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-1">Impact Level</p>
                            <div className="flex items-end gap-2 text-xl font-bold">High <Zap className="w-4 h-4 text-amber-500 mb-1" /></div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full h-11 rounded-xl font-bold uppercase tracking-wider text-xs gap-3"
                          onClick={() => setSelectedMonitorId(null)}
                        >
                          Cancel Process
                        </Button>
                      </div>
                      <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-primary/5 blur-[80px] rounded-full group-hover:bg-primary/10 transition-colors" />
                    </div>

                    <IntentDetectionDemo />
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-[500px] rounded-2xl border-2 border-dashed border-border/40 bg-muted/10 flex flex-col items-center justify-center text-center p-12"
              >
                <div className="w-20 h-20 rounded-full bg-primary/5 border border-primary/10 flex items-center justify-center mb-6">
                  <Play className="w-10 h-10 text-primary opacity-20" />
                </div>
                <h3 className="text-lg font-bold tracking-tight mb-2">Intelligence Monitoring Hub</h3>
                <p className="text-sm text-muted-foreground/60 max-w-sm font-medium italic">Select a monitor to view live intent analysis or deploy a new workflow from the reels below.</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Reels Feed Section */}
          <div className="space-y-8">
            <div className="flex items-center justify-between border-b border-border/40 pb-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/40">Media Intelligence Feed</h3>
              <div className="relative w-64 group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  placeholder="Filter Reels..."
                  className="pl-9 h-10 rounded-full bg-muted/50 border-none text-[11px] font-semibold focus-visible:ring-2 focus-visible:ring-primary/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {reelsLoading || !mounted ? (
              <ReelsSkeleton />
            ) : (
              <div className="space-y-12">
                <ResponsiveGrid className="grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6">
                  {currentReels.map((reel: any) => (
                    <motion.div
                      key={reel.id}
                      whileHover={{ y: -8, scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="group relative aspect-[9/16] rounded-3xl overflow-hidden bg-black border border-border/10 shadow-lg cursor-pointer ring-offset-background hover:ring-4 hover:ring-primary/20 transition-all"
                      onClick={() => {
                        createMonitor.mutate({
                          videoId: reel.id,
                          videoUrl: reel.url,
                          productLink: "https://supermemory.ai/demo",
                          ctaText: "Get Started",
                        });
                      }}
                      onContextMenu={(e) => handleContextMenu(e, 'video', reel)}
                    >
                      {reel.mediaUrl ? (
                        <div className="w-full h-full relative">
                          <img src={reel.thumbnailUrl} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="Reel" />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="p-4 rounded-full bg-primary/90 text-primary-foreground shadow-2xl">
                              <Plus className="w-6 h-6" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-muted/20">
                          <Instagram className="w-8 h-8 opacity-10" />
                        </div>
                      )}
                      <div className="absolute bottom-6 inset-x-6">
                        <p className="text-[10px] font-semibold text-white line-clamp-2 leading-snug opacity-80 uppercase tracking-wider">{reel.caption || "NO CAPTION"}</p>
                      </div>
                    </motion.div>
                  ))}
                </ResponsiveGrid>

                {totalPages > 1 && (
                  <div className="flex justify-center pt-8">
                    <Pagination>
                      <PaginationContent className="bg-muted/30 border border-border/50 p-1 rounded-2xl">
                        <PaginationItem>
                          <PaginationPrevious
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            className={currentPage === 1 ? "pointer-events-none opacity-20" : "cursor-pointer hover:bg-background"}
                          />
                        </PaginationItem>
                        {Array.from({ length: totalPages }).map((_, i) => (
                          <PaginationItem key={i}>
                            <PaginationLink
                              isActive={currentPage === i + 1}
                              onClick={() => setCurrentPage(i + 1)}
                              className={cn("cursor-pointer rounded-xl h-9 w-9 text-xs font-bold", currentPage === i + 1 ? "bg-primary text-primary-foreground" : "hover:bg-background")}
                            >
                              {i + 1}
                            </PaginationLink>
                          </PaginationItem>
                        ))}
                        <PaginationItem>
                          <PaginationNext
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            className={currentPage === totalPages ? "pointer-events-none opacity-20" : "cursor-pointer hover:bg-background"}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </ResponsiveGrid>

      <CustomContextMenu
        config={contextConfig}
        onClose={closeMenu}
        onAction={handleMenuAction}
      />
    </PageWrapper>
  );
}
