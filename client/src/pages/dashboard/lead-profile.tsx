import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  User,
  Tag as TagIcon,
  Calendar,
  MessageSquare,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  Activity,
  Brain,
  Zap,
  Clock,
  Send,
  TrendingUp
} from "lucide-react";
import { PremiumLoader } from "@/components/ui/premium-loader";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { LeadProcessModal } from "@/components/dashboard/LeadProcessModal";
import { useState } from "react";
import { format } from "date-fns";

const statusStyles = {
  new: "bg-primary/20 text-primary border-primary/20",
  open: "bg-primary/10 text-primary border-primary/10",
  replied: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  converted: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  not_interested: "bg-muted text-muted-foreground border-muted",
  cold: "bg-muted text-muted-foreground border-muted",
  hardened: "bg-primary/20 text-primary border-primary/20",
  recovered: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  bouncy: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function LeadProfilePage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [showProcessModal, setShowProcessModal] = useState(false);

  const { data: lead, isLoading: leadLoading } = useQuery<any>({
    queryKey: ["/api/leads", id],
    enabled: !!id,
  });

  const { data: messagesData, isLoading: messagesLoading } = useQuery<any>({
    queryKey: ["/api/messages", id],
    enabled: !!id,
  });

  if (leadLoading) {
    return (
      <div className="h-[80vh] flex items-center justify-center">
        <PremiumLoader text="Gathering lead intelligence..." />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="h-[80vh] flex flex-col items-center justify-center space-y-4">
        <h2 className="text-2xl font-bold">Lead Not Found</h2>
        <Button onClick={() => setLocation("/dashboard/inbox")}>Return to Inbox</Button>
      </div>
    );
  }

  const messages = messagesData?.messages || [];

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-border/20">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-muted"
            onClick={() => setLocation("/dashboard/inbox")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                {lead.name}
              </h1>
              <Badge variant="outline" className={cn("text-[10px] font-semibold uppercase tracking-wider px-3 py-1", statusStyles[lead.status as keyof typeof statusStyles])}>
                {lead.status === 'hardened' ? 'Verified' : lead.status}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full h-8 w-8 text-primary hover:bg-primary/10 transition-colors"
                onClick={() => setShowProcessModal(true)}
                title="View Interaction Study"
              >
                <Brain className="h-5 w-5" />
              </Button>
            </div>
            <p className="text-muted-foreground text-sm font-medium flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              {lead.company || "Individual Contributor"} {lead.role && `• ${lead.role}`}
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="rounded-xl h-11 font-semibold uppercase tracking-wider text-[10px] px-5"
            onClick={() => setLocation(`/dashboard/inbox/${id}`)}
          >
            <MessageSquare className="h-4 w-4 mr-2" /> Open Conversation
          </Button>
          <Button className="rounded-xl h-11 font-semibold uppercase tracking-wider text-[10px] px-5 shadow-md shadow-primary/15">
            <Zap className="h-4 w-4 mr-2" /> Start Campaign
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        {/* Profile Sidebar */}
        <div className="space-y-8">
          <Card className="rounded-2xl bg-card/40 backdrop-blur-2xl border-border/40 overflow-hidden shadow-xl">
            <CardHeader className="text-center pt-10 pb-6 border-b border-border/10">
              <Avatar className="h-24 w-24 mx-auto border-4 border-background shadow-xl mb-4">
                <AvatarFallback className="bg-primary/10 text-primary text-2xl font-bold">
                  {lead.name?.[0]}
                </AvatarFallback>
              </Avatar>
              <CardTitle className="text-xl font-bold">{lead.name}</CardTitle>
              <p className="text-sm text-muted-foreground font-medium">{lead.email || "No email provided"}</p>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Mail className="h-3 w-3" /> Email
                  </span>
                  <span className="text-sm font-medium">{lead.email || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <Phone className="h-3 w-3" /> Phone
                  </span>
                  <span className="text-sm font-medium">{lead.phone || "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="h-3 w-3" /> Channel
                  </span>
                  <Badge variant="secondary" className="text-[10px] font-semibold uppercase tracking-wider">
                    {lead.channel}
                  </Badge>
                </div>
              </div>

              <div className="pt-6 border-t border-border/10">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bio / Summary</p>
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  {lead.bio || "No biography available for this prospect."}
                </p>
              </div>

              <div className="pt-6 border-t border-border/10 space-y-4">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Metadata Tags</p>
                <div className="flex flex-wrap gap-2">
                  {lead.tags?.map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-[10px] bg-muted/30 border-border/40 px-3 h-6 rounded-lg">
                      {tag}
                    </Badge>
                  ))}
                  {!lead.tags?.length && <p className="text-xs text-muted-foreground/40 italic">No tags assigned</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl bg-indigo-500/5 border-indigo-500/20 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 flex items-center gap-2">
                <Brain className="h-4 w-4" /> AI Interaction Status
              </h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <span className="text-xs font-semibold">Automation Mode</span>
                <Badge className={cn(
                  "px-3 py-0.5 rounded-full text-[9px] font-semibold tracking-wider",
                  lead.aiPaused ? "bg-amber-500/20 text-amber-500 border-amber-500/20" : "bg-emerald-500/20 text-emerald-500 border-emerald-500/20"
                )}>
                  {lead.aiPaused ? "MANUAL" : "AUTONOMOUS"}
                </Badge>
              </div>
              <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs font-semibold">
                <span>Verified Status</span>
                <span className={lead.verified ? "text-emerald-500" : "text-muted-foreground/50"}>
                  {lead.verified ? "CONFIRMED" : "UNVERIFIED"}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-8">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-6 rounded-2xl bg-card/40 border-border/40 hover:border-primary/30 transition-all group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Engagement Score</span>
                <Activity className="h-4 w-4 text-primary opacity-50" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold tracking-tight text-primary">{lead.score || 0}%</span>
                <span className="text-[10px] text-muted-foreground/50 font-semibold mb-1.5 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-emerald-500" /> +5%
                </span>
              </div>
              <div className="mt-4 bg-muted/50 h-1.5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${lead.score || 0}%` }}
                  className="h-full bg-primary shadow-[0_0_10px_rgba(var(--primary),0.3)]"
                />
              </div>
            </Card>

            <Card className="p-6 rounded-2xl bg-card/40 border-border/40 hover:border-amber-500/30 transition-all group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Confidence</span>
                <Sparkles className="h-4 w-4 text-amber-500 opacity-50" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold tracking-tight text-amber-500">{(lead.pdfConfidence * 100 || 0).toFixed(0)}%</span>
                <span className="text-[10px] text-muted-foreground/50 font-semibold mb-1.5">Model Score</span>
              </div>
              <div className="mt-4 bg-muted/50 h-1.5 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(lead.pdfConfidence * 100) || 0}%` }}
                  className="h-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]"
                />
              </div>
            </Card>

            <Card className="p-6 rounded-2xl bg-card/40 border-border/40 hover:border-indigo-500/30 transition-all group">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Messages</span>
                <MessageSquare className="h-4 w-4 text-indigo-500 opacity-50" />
              </div>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold tracking-tight text-indigo-500">{messages.length}</span>
                <span className="text-[10px] text-muted-foreground/50 font-semibold mb-1.5">Conversations</span>
              </div>
            </Card>
          </div>

          {/* Interaction Timeline */}
          <Card className="rounded-2xl border-border/40 bg-card/30 overflow-hidden shadow-lg">
            <CardHeader className="p-6 border-b border-border/10 flex flex-row items-center justify-between">
              <CardTitle className="text-lg font-bold flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                Recent History
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-[10px] font-semibold uppercase tracking-wider h-8 px-4 rounded-full">
                Full Log <ExternalLink className="h-3 w-3 ml-2" />
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {messagesLoading ? (
                <div className="p-12 flex justify-center"><PremiumLoader text="Fetching messages..." /></div>
              ) : messages.length > 0 ? (
                <div className="divide-y divide-border/5">
                  {messages.map((msg: any) => (
                    <div key={msg.id} className="p-6 hover:bg-muted/10 transition-colors group">
                      <div className="flex gap-6">
                        <div className={cn(
                          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                          msg.direction === 'inbound' ? "bg-indigo-500/10 text-indigo-500" : "bg-primary/10 text-primary"
                        )}>
                          {msg.direction === 'inbound' ? <MessageSquare className="h-5 w-5" /> : <Send className="h-5 w-5" />}
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                              {msg.direction === 'inbound' ? 'Inbound Message' : 'Campaign Sent'}
                              {msg.metadata?.aiGenerated && <span className="ml-2 text-primary">• AI Generated</span>}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-medium">
                              {format(new Date(msg.createdAt), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed text-foreground/80 max-w-3xl whitespace-pre-wrap">{msg.body}</p>
                          {msg.openedAt && (
                            <div className="flex items-center gap-2 pt-2">
                              <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded-full border border-emerald-500/10">Read</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
                  <Clock className="h-12 w-12 text-muted-foreground/20" />
                  <div>
                    <p className="font-semibold text-muted-foreground/60">No interactions yet</p>
                    <p className="text-xs text-muted-foreground/40 max-w-xs mt-1 px-8">Interactions will be logged here as your campaigns reach this prospect.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Activity Logs / Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card className="p-6 rounded-2xl border-border/40 bg-card/20 space-y-6 shadow-md">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <User className="h-4 w-4" /> System Metadata
              </h4>
              <div className="space-y-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-wider">External ID</span>
                  <code className="text-[11px] text-foreground font-mono bg-muted/40 p-2 rounded-lg">{lead.externalId || "N/A"}</code>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold text-muted-foreground/30 uppercase tracking-wider">Intelligence Score</span>
                  <code className="text-[11px] text-foreground font-mono bg-muted/40 p-2 rounded-lg">{lead.score || 0} (Normalized)</code>
                </div>
              </div>
            </Card>

            <Card className="p-6 rounded-2xl border-border/40 bg-card/20 space-y-6 shadow-md">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Growth Timeline
              </h4>
              <div className="space-y-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Discovered</span>
                  <span className="font-semibold">{new Date(lead.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Last Message</span>
                  <span className="font-semibold">{lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleDateString() : "Never"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Verified On</span>
                  <span className="font-semibold">{lead.verifiedAt ? new Date(lead.verifiedAt).toLocaleDateString() : "Pending"}</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
      <LeadProcessModal
        isOpen={showProcessModal}
        onClose={() => setShowProcessModal(false)}
        lead={lead}
        messages={messages}
      />
    </div>
  );
}
