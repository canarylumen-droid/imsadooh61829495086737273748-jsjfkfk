import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRealtime } from "@/hooks/use-realtime";
import { Loader2, Plus, Play, Pause, Activity, Loader, StopCircle, Mail, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

  useEffect(() => {
    if (!socket) return;
    const handler = () => queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
    socket.on("leads_updated", handler);
    socket.on("campaign_update", handler);
    return () => { socket.off("leads_updated", handler); socket.off("campaign_update", handler); };
  }, [socket, queryClient]);

  const { data: campaigns, isLoading } = useQuery<any[]>({
    queryKey: ["/api/outreach/campaigns"],
    enabled: isOpen,
    staleTime: 10_000,
  });

  const totalPages = Math.max(1, Math.ceil((campaigns?.length || 0) / PAGE_SIZE));
  const pagedCampaigns = useMemo(() => {
    if (!campaigns) return [];
    return campaigns.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  }, [campaigns, page]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "start" | "pause" | "resume" }) => {
      await apiRequest("POST", `/api/outreach/campaigns/${id}/${action}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outreach/campaigns"] });
      toast({ title: "Campaign Updated", description: "Status changed successfully." });
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
      toast({ title: "Campaign Aborted", description: "Campaign and pending queue stopped permanently." });
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
      toast({ title: "Campaign Deleted", description: "Campaign and all associated data removed." });
    },
    onError: (error: any) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    }
  });

  const getCampaignETA = (camp: any) => {
    if (camp.status === 'aborted') return 'Aborted';
    if (camp.status === 'completed') return 'Done';
    if (camp.status === 'draft') return 'Not Started';
    if (camp.status === 'paused') return 'Paused';

    const total = camp.stats?.total || 0;
    const sent = camp.stats?.sent || 0;
    const remaining = Math.max(0, total - sent);
    
    if (remaining === 0) return '~0d';

    const config = camp.config || {};
    const dailyLimit = config.totalDailyLimit || config.dailyLimit || 50;
    const maxMailboxes = Object.keys(config.mailboxLimits || {}).length || 1;
    const effectiveLimit = dailyLimit * maxMailboxes;
    
    if (effectiveLimit <= 0) return 'Unknown';

    // Use actual send rate if available, otherwise estimate
    const createdAt = camp.createdAt ? new Date(camp.createdAt).getTime() : 0;
    const elapsed = createdAt > 0 ? (Date.now() - createdAt) / (1000 * 60 * 60 * 24) : 0;
    let actualPerDay = effectiveLimit;
    if (elapsed > 0.5 && sent > 0) {
      actualPerDay = Math.max(1, Math.ceil(sent / elapsed));
    }

    const days = Math.ceil(remaining / Math.min(effectiveLimit, Math.max(10, actualPerDay)));
    return `~${days} ${days === 1 ? 'day' : 'days'}`;
  };

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
      <DialogContent className="sm:max-w-[700px] border-border/40 bg-background/95 backdrop-blur-xl p-0 overflow-hidden shadow-2xl">
        <DialogHeader className="p-6 pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-black uppercase tracking-widest flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              Campaign Manager
            </DialogTitle>
            <Button 
              onClick={() => {
                onClose();
                onNewCampaign();
              }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1 text-xs uppercase font-black tracking-widest shadow-[0_0_15px_rgba(var(--primary),0.3)]"
            >
              <Plus className="w-4 h-4" /> New Campaign
            </Button>
          </div>
        </DialogHeader>

        <div className="p-6 pt-2 pb-8 max-h-[60vh] overflow-y-auto no-scrollbar">
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
                const isPending = updateStatusMutation.isPending && updateStatusMutation.variables?.id === camp.id;
                const isAborting = abortMutation.isPending && abortMutation.variables === camp.id;
                const isDeleting = deleteMutation.isPending && deleteMutation.variables === camp.id;
                
                return (
                  <div key={camp.id} className="bg-card p-5 rounded-2xl border border-border/40 shadow-sm flex items-center justify-between group transition-all hover:border-primary/30">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-3">
                        <h4 className="font-bold text-base">{camp.name}</h4>
                        {getStatusBadge(camp.status)}
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground mt-1">
                        <span><strong className="text-foreground">{camp.stats?.sent || 0}</strong> Sent</span>
                        <span><strong className="text-foreground">{camp.stats?.replied || 0}</strong> Replied</span>
                        <span>Total Queue: <strong className="text-foreground">{camp.stats?.total || 0}</strong></span>
                        <span className="flex items-center gap-1 bg-primary/5 px-2 py-0.5 rounded-md border border-primary/10">
                          ETA: <strong className="text-primary">{getCampaignETA(camp)}</strong>
                        </span>
                      </div>
                    </div>
                    
                    {/* Action Controls */}
                    <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity bg-muted/30 p-1.5 rounded-xl border border-border/10">
                      {(camp.status === 'draft' || camp.status === 'paused') && camp.status !== 'aborted' && camp.status !== 'completed' && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="w-8 h-8 rounded-lg hover:bg-emerald-500/10 hover:text-emerald-500"
                          onClick={() => updateStatusMutation.mutate({ id: camp.id, action: camp.status === 'draft' ? 'start' : 'resume' })}
                          disabled={isPending || isAborting}
                          title="Start / Resume"
                        >
                          {isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </Button>
                      )}
                      
                      {camp.status === 'active' && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="w-8 h-8 rounded-lg hover:bg-amber-500/10 hover:text-amber-500"
                          onClick={() => updateStatusMutation.mutate({ id: camp.id, action: 'pause' })}
                          disabled={isPending || isAborting}
                          title="Pause"
                        >
                          {isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Pause className="w-4 h-4" />}
                        </Button>
                      )}
                      
                      {(camp.status === 'active' || camp.status === 'paused' || camp.status === 'draft') && (
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          className="w-8 h-8 rounded-lg hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Abort "${camp.name}"? This stops all pending follow-ups and cannot be undone.`)) {
                              abortMutation.mutate(camp.id);
                            }
                          }}
                          disabled={isAborting || isPending || isDeleting}
                          title="Abort Campaign"
                        >
                          {isAborting ? <Loader className="w-4 h-4 animate-spin" /> : <StopCircle className="w-4 h-4" />}
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="w-8 h-8 rounded-lg hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => {
                          if (confirm(`Permanently delete "${camp.name}"? All leads and data will be removed.`)) {
                            deleteMutation.mutate(camp.id);
                          }
                        }}
                        disabled={isDeleting || isPending || isAborting}
                        title="Delete Campaign"
                      >
                        {isDeleting ? <Loader className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                      </Button>
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
