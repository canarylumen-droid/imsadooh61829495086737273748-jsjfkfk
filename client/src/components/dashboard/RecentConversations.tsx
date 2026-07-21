import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatRelativeTime, formatDateFull } from "@/lib/format-date";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Instagram,
  Mail,
  X,
  Loader2,
  MessageCircle,
  ArrowLeft,
  Clock,
  Sparkles,
} from "lucide-react";
import { SiGoogle } from "react-icons/si";
import { useRealtime } from "@/hooks/use-realtime";
import { useMailbox } from "@/hooks/use-mailbox";
import { useQueryClient } from "@tanstack/react-query";

type Channel = "instagram" | "email" | "gmail" | "outlook";

interface Message {
  id: string;
  body: string;
  direction: "inbound" | "outbound";
  createdAt: string;
  audioUrl?: string;
}

interface Lead {
  id: string;
  name: string;
  channel: string;
  status: string;
  lastMessageAt: string;
  score: number;
  metadata?: {
    provider?: string;
  };
}

const channelConfig: Record<string, any> = {
  instagram: {
    icon: Instagram,
    label: "Instagram",
    color: "from-fuchsia-500 to-purple-600",
    bgColor: "bg-fuchsia-500/10",
    textColor: "text-fuchsia-500",
  },
  email: {
    icon: Mail,
    label: "Email",
    color: "from-primary to-primary/60",
    bgColor: "bg-primary/10",
    textColor: "text-primary",
  },
  gmail: {
    icon: SiGoogle,
    label: "Gmail",
    color: "from-red-500 to-orange-500",
    bgColor: "bg-red-500/10",
    textColor: "text-red-500",
  },
  outlook: {
    icon: Mail,
    label: "Outlook",
    color: "from-blue-500 to-indigo-600",
    bgColor: "bg-blue-500/10",
    textColor: "text-blue-500",
  },
};

export function RecentConversations() {
  const queryClient = useQueryClient();
  const { socket } = useRealtime();
  const { selectedMailboxId } = useMailbox();
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel>("email");

  const { data: integrations } = useQuery<any[]>({
    queryKey: ["/api/integrations"],
    select: (data: any) => data.integrations || [],
  });

  const isAnyChannelConnected = integrations?.some(i => i.connected) ?? false;

  // Real-time synchronization
  useEffect(() => {
    if (!socket) return;

    let timeoutId: number;
    const debouncedInvalidateLeads = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      }, 300);
    };

    const handleLeadsUpdated = (payload: any) => {
      // If the update targets our currently selected mailbox, or if we're in "all" view
      if (!selectedMailboxId || payload.integrationId === selectedMailboxId) {
        debouncedInvalidateLeads();
      }
    };

    const handleThreadUpdate = (payload: any) => {
      // payload: { leadId, userId, message }
      
      // Invalidate the leads list to show the new snippet (debounced)
      debouncedInvalidateLeads();
      
      // If we are currently viewing this specific lead, invalidate messages
      if (selectedLead?.id === payload.leadId) {
        queryClient.invalidateQueries({ queryKey: ["/api/leads", payload.leadId, "messages"] });
      }
    };

    socket.on("leads_updated", handleLeadsUpdated);
    socket.on("thread:update", handleThreadUpdate);

    return () => {
      socket.off("leads_updated", handleLeadsUpdated);
      socket.off("thread:update", handleThreadUpdate);
    };
  }, [socket, selectedMailboxId, selectedLead?.id, queryClient]);

  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ["/api/leads", { integrationId: selectedMailboxId, limit: 20 }],
    queryFn: async () => {
      const url = new URL("/api/leads", window.location.origin);
      if (selectedMailboxId) url.searchParams.set("integrationId", selectedMailboxId);
      url.searchParams.set("limit", "20");
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Failed to fetch leads");
      return res.json();
    }
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ["/api/messages", selectedLead?.id],
    queryFn: async () => {
      if (!selectedLead?.id) return { messages: [] };
      const res = await fetch(`/api/messages/${selectedLead.id}`, { credentials: "include" });
      if (!res.ok) return { messages: [] };
      return res.json();
    },
    enabled: !!selectedLead,
  });

  const allLeads = Array.isArray(leadsData) ? leadsData : (leadsData as any)?.leads || [];
  const hasLoadedLeads = Array.isArray(leadsData) || Array.isArray((leadsData as any)?.leads);
  const messages = (messagesData as any)?.messages || [];
  const leads = allLeads.filter((l: Lead) => {
    const ch = l.channel || l.metadata?.provider || 'email';
    if (selectedChannel === 'email') return ['email', 'gmail', 'outlook'].includes(ch);
    return ch === selectedChannel;
  });

  if (selectedLead) {
    return (
      <Card className="h-full flex flex-col border-border/40 bg-card/40 backdrop-blur-xl rounded-[2rem] overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-border/30 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSelectedLead(null)}
            className="rounded-full hover:bg-muted/50 h-10 w-10 transition-transform active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar className="h-12 w-12 border-2 border-border/30">
            <AvatarFallback className={`${channelConfig[selectedLead.channel]?.bgColor || channelConfig.email.bgColor} ${channelConfig[selectedLead.channel]?.textColor || channelConfig.email.textColor} font-semibold text-lg`}>
              {selectedLead.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h3 className="text-lg font-semibold tracking-tight text-foreground uppercase">{selectedLead.name}</h3>
            <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
              {(() => {
                const provider = selectedLead.metadata?.provider || selectedLead.channel;
                const config = channelConfig[provider] || channelConfig.email;
                const ChannelIcon = config.icon;
                return <ChannelIcon className="h-3 w-3" />;
              })()}
              <span>{(() => {
                const provider = selectedLead.metadata?.provider || selectedLead.channel;
                const config = channelConfig[provider] || channelConfig.email;
                return config.label;
              })()} CORE</span>
            </div>
          </div>
          <Badge
            variant="outline"
            className={
              selectedLead.status === "converted"
                ? "bg-purple-500/10 text-purple-500 border-purple-500/20 font-semibold px-3"
                : selectedLead.status === "replied"
                  ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-semibold px-3"
                  : "bg-primary/10 text-primary border-primary/20 font-semibold px-3"
            }
          >
            {selectedLead.status.toUpperCase()}
          </Badge>
        </div>

        <ScrollArea className="flex-1 p-4">
          {messagesLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-20" />
              <p>No messages yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message: Message, index: number) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"
                    }`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${message.direction === "outbound"
                      ? `bg-gradient-to-r ${channelConfig[selectedLead.metadata?.provider || selectedLead.channel]?.color || channelConfig.email.color} text-white`
                      : "bg-muted"
                      }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">{message.body}</p>
                    {message.audioUrl && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <audio controls className="w-full max-w-xs">
                          <source src={message.audioUrl} type="audio/mpeg" />
                        </audio>
                      </div>
                    )}
                    <div
                      className={`flex items-center gap-1 mt-1 text-xs ${message.direction === "outbound"
                        ? "text-white/70"
                        : "text-muted-foreground"
                        }`}
                    >
                      {selectedLead.channel === "outlook" && (
                        <Mail className="h-4 w-4 text-blue-600" />
                      )}
                      <span>{formatDateFull(message.createdAt)}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col border-border/40 bg-card/40 backdrop-blur-xl rounded-[2rem] overflow-hidden">
      <div className="p-6 border-b border-border/20 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.4em] text-muted-foreground">Recent Activity</h2>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-wider">Live</span>
          </div>
        </div>

        <div className="flex p-1.5 bg-muted/20 backdrop-blur-md rounded-2xl border border-border/20 relative">
          {(Object.keys(channelConfig) as Channel[]).map((channel) => {
            const config = channelConfig[channel];
            const ChannelIcon = config.icon;
            const isActive = selectedChannel === channel;

            return (
              <button
                key={channel}
                onClick={() => setSelectedChannel(channel)}
                className={`flex-1 relative z-10 py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all duration-300 ${isActive ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"
                  }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-channel"
                    className={`absolute inset-0 rounded-xl bg-gradient-to-br ${config.color} shadow-lg`}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <ChannelIcon className="h-4 w-4 relative z-20" />
                <span className="text-[10px] font-semibold uppercase tracking-widest relative z-20">{config.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <CardContent className="p-4">
          {leadsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-12">
              <MessageCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-20" />
              <p className="text-muted-foreground mb-2">
                No recent {channelConfig[selectedChannel].label} conversations
              </p>
              {hasLoadedLeads ? (
                <p className="text-xs text-muted-foreground">
                  {isAnyChannelConnected
                    ? "Waiting for new leads to arrive..."
                    : "Connect your account to start receiving leads"}
                </p>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading leads...</span>
                </div>
              )}
            </div>
          ) : (
              <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {leads.map((lead: Lead, index: number) => {
                  const provider = lead.metadata?.provider || lead.channel;
                  const config = channelConfig[provider] || channelConfig.email;
                  const ChannelIcon = config.icon;

                  return (
                    <motion.div
                      key={lead.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ delay: index * 0.05 }}
                      whileHover={{ scale: 1.02, x: 5 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <button
                        onClick={() => setSelectedLead(lead)}
                        className="w-full p-4 rounded-2xl border border-border/20 bg-muted/10 hover:bg-muted/30 hover:border-border/60 transition-all text-left group relative overflow-hidden"
                      >
                        <div className="flex items-center gap-4">
                          <Avatar className="h-12 w-12 rounded-2xl border-2 border-border/20 transition-transform group-hover:scale-110">
                            <AvatarFallback className={`${config.bgColor} ${config.textColor} font-semibold text-md`}>
                              {lead.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1.5">
                              <h4 className="font-semibold text-foreground text-md uppercase tracking-tight group-hover:text-primary transition-colors">
                                {lead.name}
                              </h4>
                              <span className="text-[9px] font-medium uppercase tracking-widest text-muted-foreground/40">
                                {formatRelativeTime(lead.lastMessageAt)}
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className={`p-1.5 rounded-lg bg-muted/30 border border-border/20 ${config.textColor}`}>
                                <ChannelIcon className="h-3 w-3" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/40">Score:</span>
                                <span className={`text-[10px] font-bold ${lead.score > 80 ? 'text-orange-500' : 'text-primary'}`}>{lead.score}</span>
                              </div>
                              <Badge
                                variant="outline"
                                className={
                                  lead.status === "converted"
                                    ? "bg-purple-500/10 text-purple-500 border-purple-500/20 text-[9px] font-bold px-2 mt-0.5"
                                    : lead.status === "replied"
                                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[9px] font-bold px-2 mt-0.5"
                                      : "bg-primary/10 text-primary border-primary/20 text-[9px] font-bold px-2 mt-0.5"
                                }
                              >
                                {lead.status.toUpperCase()}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        {/* Glow indicator on hover */}
                        <div className="absolute top-0 right-0 w-32 h-32 blur-[40px] opacity-0 group-hover:opacity-10 bg-primary rounded-full translate-x-10 -translate-y-10 transition-opacity" />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
