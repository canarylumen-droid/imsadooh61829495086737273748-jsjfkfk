import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/hooks/use-realtime";
import { Loader2, Plus, Play, Pause, Activity, Loader, StopCircle, Mail, ChevronLeft, ChevronRight, Send, MessageSquare, Clock, Trash2, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CampaignListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNewCampaign: () => void;
}

const PAGE_SIZE = 10;

export function CampaignListModal({ isOpen, onClose, onNewCampaign }: CampaignListModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const [page, setPage] = useState(0);
  const [progressMap, setProgressMap] = useState<Record<string, any>>({});
  const prevDataRef = useRef<string>('');

  useEffect(() => {
    if (!socket) return;
    const handler = () => queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
    socket.on("leads_updated", handler);
    socket.on("campaign_update", (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
      if (data?.campaignId) {
        queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns", data.campaignId, "progress"] });
      }
    });
    return () => { socket.off("leads_updated", handler); socket.off("campaign_update", handler); };
  }, [socket, queryClient]);

  const { data: campaigns, isLoading } = useQuery<any[]>({
    queryKey: ["/api/outreach/campaigns"],
    enabled: isOpen,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const totalPages = Math.max(1, Math.ceil((campaigns?.length || 0) / PAGE_SIZE));
  const pagedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return campaigns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [campaigns, page]);

  const campaignIds = useMemo(() => pagedCampaigns.map(c => c.id), [pagedCampaigns]);

  useEffect(() => {
    if (!campaignIds.length) return;
    const fetchProgress = async () => {
      const results: Record<string, any> = {};
      await Promise.all(campaignIds.map(async (id) => {
        try {
          const res = await fetch(`/api/outreach/campaigns/${id}/progress`);
          if (res.ok) results[id] = await res.json();
        } catch {}
      }));
      const key = JSON.stringify(results);
      if (key !== prevDataRef.current) {
        prevDataRef.current = key;
        setProgressMap(results);
      }
    };
    fetchProgress();
    const interval = setInterval(fetchProgress, 15000);
    return () => clearInterval(interval);
  }, [campaignIds]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "start" | "pause" | "resume" }) => {
      await apiRequest("POST", `/api/outreach/campaigns/${id}/${action}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
      toast({ title: "Campaign Updated" });
    },
    onError: (error: any) => {
      toast({ title: "Update Failed", description: error.message, variant: "destructive" });
    }
  });

  const abortMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/outreach/campaigns/${id}/abort`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
      toast({ title: "Campaign Aborted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to abort", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/outreach/campaigns/${id}`, undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
      toast({ title: "Campaign Deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20"><Activity className="w-3 h-3 mr-1" /> Active</Badge>;
      case "paused":
        return <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20"><Pause className="w-3 h-3 mr-1" /> Paused</Badge>;
      case "draft":
        return <Badge className="bg-slate-500/10 text-slate-500 border-slate-500/20">Draft</Badge>;
      case "completed":
        return <Badge className="bg-primary/10 text-primary border-primary/20">Completed</Badge>;
      case "aborted":
        return <Badge className="bg-destructive/10 text-destructive border-destructive/20">Aborted</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[800px] border-border/40 bg-background/95 backdrop-blur-xl p-0 overflow-hidden shadow-2xl [&>button]:opacity-100 [&>button]:text-muted-foreground [&>button]:hover:text-foreground [&>button]:transition-all">
        <DialogHeader className="p-6 pb-2">
          <div className="flex items-center justify-between pr-8">
            <DialogTitle className="text-xl font-black uppercase tracking-widest flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              Campaign Manager
            </DialogTitle>
            <Button 
              onClick={() => { onClose(); onNewCampaign(); }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1 text-xs uppercase font-black tracking-widest shadow-[0_0_15px_rgba(var(--primary),0.3)]"
            >
              <Plus className="w-4 h-4" /> New Campaign
            </Button>
          </div>
        </DialogHeader>

        <div className="p-6 pt-2 pb-8 max-h-[65vh] overflow-y-auto no-scrollbar">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
              <p className="text-xs uppercase font-bold tracking-widest">Loading Campaigns...</p>
            </div>
          ) : !campaigns || campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center bg-muted/20 rounded-2xl border border-border/10">
              <Mail className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <h3 className="font-black uppercase tracking-widest mb-2">No Active Campaigns</h3>
              <p className="text-xs text-muted-foreground max-w-sm mb-6">
                Launch your first AI-driven outreach sequence to start generating high-ticket conversations.
              </p>
              <Button onClick={() => { onClose(); onNewCampaign(); }} className="bg-primary text-primary-foreground text-xs uppercase font-black tracking-widest">
                Create First Campaign
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {pagedCampaigns.map((camp) => {
                const prog = progressMap[camp.id];
                const isPending = updateStatusMutation.isPending && updateStatusMutation.variables?.id === camp.id;
                const isAborting = abortMutation.isPending && abortMutation.variables === camp.id;
                const isDeleting = deleteMutation.isPending && deleteMutation.variables === camp.id;
                const progress = prog?.total > 0 ? Math.round((prog.sent / prog.total) * 100) : 0;
                const todayPct = prog?.dailyLimit > 0 ? Math.round((prog.todaySent / prog.dailyLimit) * 100) : 0;
                
                return (
                  <div key={camp.id} className="bg-card p-5 rounded-2xl border border-border/40 shadow-sm transition-all hover:border-primary/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <h4 className="font-bold text-base truncate">{camp.name}</h4>
                        {getStatusBadge(camp.status)}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-3">
                        {(camp.status === 'draft' || camp.status === 'paused') && (
                          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-emerald-500/10 hover:text-emerald-500"
                            onClick={() => updateStatusMutation.mutate({ id: camp.id, action: camp.status === 'draft' ? 'start' : 'resume' })}
                            disabled={isPending || isAborting} title="Start / Resume">
                            {isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          </Button>
                        )}
                        {camp.status === 'active' && (
                          <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-amber-500/10 hover:text-amber-500"
                            onClick={() => updateStatusMutation.mutate({ id: camp.id, action: 'pause' })}
                            disabled={isPending || isAborting} title="Pause">
                            {isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                          </Button>
                        )}
                        {(camp.status === 'active' || camp.status === 'paused' || camp.status === 'draft') && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" className="w-8 h-8 rounded-lg hover:bg-muted" disabled={isAborting || isPending}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="rounded-xl border-border/40 min-w-[160px]">
                              <DropdownMenuItem className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive"
                                onClick={() => { if (confirm(`Abort "${camp.name}"?`)) abortMutation.mutate(camp.id); }}
                                disabled={isAborting}>
                                <StopCircle className="w-3.5 h-3.5" /> Abort Campaign
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive"
                                onClick={() => { if (confirm(`Delete "${camp.name}"?`)) deleteMutation.mutate(camp.id); }}
                                disabled={isDeleting}>
                                <Trash2 className="w-3.5 h-3.5" /> Delete Campaign
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground mt-3 flex-wrap">
                      <span className="flex items-center gap-1"><Send className="w-3 h-3 text-primary" /> <strong className="text-foreground">{prog?.sent || camp.stats?.sent || 0}</strong> Sent</span>
                      <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3 text-emerald-500" /> <strong className="text-foreground">{prog?.replied || camp.stats?.replied || 0}</strong> Replied</span>
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-muted-foreground" /> <strong className="text-foreground">{prog?.total || camp.stats?.total || 0}</strong> Total</span>
                      {prog && (
                        <span className="flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                          <Clock className="w-3 h-3 text-amber-500" />
                          Today: <strong className="text-amber-500">{prog.todaySent}</strong>/{prog.dailyLimit}
                        </span>
                      )}
                      {prog?.etaDays !== undefined && prog?.etaDays > 0 && (
                        <span className="flex items-center gap-1 bg-primary/5 px-2 py-0.5 rounded-md border border-primary/10">
                          ETA: <strong className="text-primary">{prog.etaLabel}</strong>
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${Math.max(0.5, progress)}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-muted-foreground w-8 text-right">{progress}%</span>
                      </div>
                      {prog && camp.status === 'active' && (
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all duration-500", todayPct >= 90 ? "bg-destructive" : todayPct >= 70 ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${Math.max(0.5, todayPct)}%` }} />
                          </div>
                          <span className="text-[10px] font-bold text-muted-foreground w-8 text-right">{todayPct}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t border-border/20">
                  <span className="text-[11px] text-muted-foreground font-medium">
                    Page {page + 1} of {totalPages} &bull; {campaigns?.length || 0} campaigns
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
