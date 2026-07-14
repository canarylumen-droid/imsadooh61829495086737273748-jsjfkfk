import { motion } from "framer-motion";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "@/hooks/use-realtime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  MessageSquare,
  Mail,
  Calendar,
  Video,
  TrendingUp,
  Loader2,
  Activity,
  RefreshCw,
  Filter,
  Shield,
  Zap
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { PageWrapper } from "@/components/ui/page-wrapper";
import { ResponsiveGrid } from "@/components/ui/responsive-grid";

interface AIDecision {
  id: string;
  actionType: string;
  decision: 'act' | 'wait' | 'skip' | 'escalate';
  intentScore: number;
  timingScore: number;
  confidence: number;
  reasoning: string;
  leadId?: string;
  createdAt: string;
}

interface DecisionStats {
  total: number;
  acted: number;
  waited: number;
  skipped: number;
  escalated: number;
  avgIntentScore: number;
  avgConfidence: number;
}

const DECISION_ICONS = {
  act: CheckCircle,
  wait: Clock,
  skip: XCircle,
  escalate: AlertTriangle,
};

const DECISION_COLORS = {
  act: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20',
  wait: 'text-amber-500 bg-amber-500/10 border-amber-500/20',
  skip: 'text-red-500 bg-red-500/10 border-red-500/20',
  escalate: 'text-purple-500 bg-purple-500/10 border-purple-500/20',
};

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  calendar_booking: Calendar,
  video_sent: Video,
  dm_sent: MessageSquare,
  follow_up: Mail,
  objection_handled: MessageSquare,
};

export default function AIDecisionsPage() {
  useRealtime();
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [decisionFilter, setDecisionFilter] = useState<string>('all');
  const queryClient = useQueryClient();

  const { data: decisions, isLoading } = useQuery<AIDecision[]>({
    queryKey: ['/api/automation/decisions'],
    retry: false,
  });

  const stats: DecisionStats = {
    total: decisions?.length || 0,
    acted: decisions?.filter(d => d.decision === 'act').length || 0,
    waited: decisions?.filter(d => d.decision === 'wait').length || 0,
    skipped: decisions?.filter(d => d.decision === 'skip').length || 0,
    escalated: decisions?.filter(d => d.decision === 'escalate').length || 0,
    avgIntentScore: decisions?.length
      ? Math.round(decisions.reduce((sum, d) => sum + (d.intentScore || 0), 0) / decisions.length)
      : 0,
    avgConfidence: decisions?.length
      ? Math.round(decisions.reduce((sum, d) => sum + (d.confidence || 0), 0) / decisions.length * 100)
      : 0,
  };

  const filteredDecisions = decisions?.filter(d => {
    if (actionFilter !== 'all' && d.actionType !== actionFilter) return false;
    if (decisionFilter !== 'all' && d.decision !== decisionFilter) return false;
    return true;
  }) || [];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/automation/decisions'] });
  };

  return (
    <PageWrapper className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-border/20">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground/90 to-primary/80 bg-clip-text text-transparent flex items-center gap-3">
            <Brain className="h-8 w-8 text-primary/80" />
            Transparency Log
          </h1>
          <p className="text-muted-foreground/80 text-base font-medium tracking-tight">
            Every AI decision and interaction logged.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl border-border/40 hover:bg-muted/50 transition-all font-semibold uppercase tracking-wider text-[10px] h-10 px-5 backdrop-blur-md"
            onClick={handleRefresh}
          >
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh Log
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <ResponsiveGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          label="Total Events"
          value={stats.total}
          icon={Activity}
          color="text-primary"
          delay={0}
        />
        <StatCard
          label="Success Rate"
          value={`${stats.total > 0 ? Math.round((stats.acted / stats.total) * 100) : 0}%`}
          subtext="APV"
          icon={CheckCircle}
          color="text-emerald-500"
          delay={0.1}
        />
        <StatCard
          label="Decision Affinity"
          value={`${stats.avgIntentScore}%`}
          icon={TrendingUp}
          color="text-amber-500"
          delay={0.2}
        />
        <StatCard
          label="AI Stability"
          value={`${stats.avgConfidence}%`}
          icon={Brain}
          color="text-indigo-500"
          delay={0.3}
        />
      </ResponsiveGrid>

      {/* Oversight Engine Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
      >
        <Card className="bg-gradient-to-r from-primary/5 via-purple-500/5 to-background border-primary/10 rounded-2xl overflow-hidden relative group">
          <div className="absolute top-0 right-0 w-64 h-64 blur-[100px] opacity-20 bg-primary/30 rounded-full group-hover:opacity-30 transition-opacity" />
          <CardContent className="p-8 relative z-10">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="p-5 bg-card/50 backdrop-blur-xl rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/10 shrink-0">
                <Shield className="h-10 w-10 text-primary" />
              </div>
              <div className="text-center md:text-left">
                <h3 className="text-lg font-bold text-foreground flex items-center justify-center md:justify-start gap-2">
                  Intelligence Oversight Engine
                  <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 text-[9px] uppercase tracking-wider border-emerald-500/20">Active</Badge>
                </h3>
                <p className="text-sm text-muted-foreground/80 mt-3 font-medium leading-relaxed max-w-2xl">
                  AI operates with strict safety guidelines. Every action requires minimum intent
                  thresholds and confidence scores. Decisions are categorized as <span className="text-emerald-500 font-bold">ACT</span>, <span className="text-amber-500 font-bold">WAIT</span>,
                  <span className="text-red-500 font-bold">SKIP</span>, or <span className="text-purple-500 font-bold">ESCALATE</span>.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Main Content */}
      <Card className="border-border/40 bg-card/30 backdrop-blur-xl rounded-2xl overflow-hidden shadow-sm">
        <div className="px-8 pt-8 pb-4 border-b border-border/10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-xl">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Decision Log</h2>
            </div>

            <div className="flex gap-3">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-[160px] rounded-xl h-10 border-border/20 bg-background/50 text-xs font-medium uppercase tracking-wider backdrop-blur-xl">
                  <div className="flex items-center gap-2">
                    <Filter className="h-3.5 w-3.5 opacity-50" />
                    <SelectValue placeholder="Action Type" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="calendar_booking">Calendar Booking</SelectItem>
                  <SelectItem value="dm_sent">DM Sent</SelectItem>
                  <SelectItem value="follow_up">Follow Up</SelectItem>
                  <SelectItem value="video_sent">Video Sent</SelectItem>
                </SelectContent>
              </Select>

              <Select value={decisionFilter} onValueChange={setDecisionFilter}>
                <SelectTrigger className="w-[140px] rounded-xl h-10 border-border/20 bg-background/50 text-xs font-medium uppercase tracking-wider backdrop-blur-xl">
                  <SelectValue placeholder="Decision" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Decisions</SelectItem>
                  <SelectItem value="act">Act</SelectItem>
                  <SelectItem value="wait">Wait</SelectItem>
                  <SelectItem value="skip">Skip</SelectItem>
                  <SelectItem value="escalate">Escalate</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <PremiumLoader text="Syncing decisions..." />
            </div>
          ) : !filteredDecisions.length ? (
            <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
              <div className="h-16 w-16 bg-muted/20 rounded-full flex items-center justify-center mb-2">
                <Brain className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-lg text-foreground/80">No Decisions Yet</h3>
                <p className="text-sm text-muted-foreground max-w-sm px-4">
                  AI decisions will appear here as soon as your automation engine processes new leads.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/10">
              {filteredDecisions.map((decision) => (
                <DecisionRow key={decision.id} decision={decision} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageWrapper>
  );
}

function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  color,
  delay
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: "easeOut" }}
    >
      <Card className="border-border/40 bg-card/40 backdrop-blur-xl rounded-2xl overflow-hidden group hover:scale-[1.02] hover:border-primary/20 transition-all duration-500 shadow-sm h-full">
        <CardContent className="p-6 pb-6 flex flex-col justify-between h-full">
          <div className="flex items-start justify-between mb-8">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">{label}</div>
            <div className={cn("p-2.5 rounded-xl transition-transform group-hover:scale-110 duration-500 bg-muted/10", color.replace('text-', 'bg-').replace('500', '500/10'))}>
              <Icon className={cn("h-5 w-5", color)} />
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold text-foreground tracking-tight mb-1">{value}</div>
            {subtext && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-500/80">{subtext}</div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function DecisionRow({ decision }: { decision: AIDecision }) {
  const DecisionIcon = DECISION_ICONS[decision.decision];
  const ActionIcon = ACTION_ICONS[decision.actionType] || MessageSquare;
  const colorClass = DECISION_COLORS[decision.decision];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 md:p-8 hover:bg-muted/10 transition-colors group"
    >
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex flex-col items-center gap-3 shrink-0">
          <div className={cn("p-3 rounded-xl shadow-sm transition-transform group-hover:scale-105", colorClass.split(' ')[1], colorClass.split(' ')[2].replace('border-', 'border-opacity-50 border-2 '))}>
            <DecisionIcon className={cn("h-6 w-6", colorClass.split(' ')[0])} />
          </div>
          <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/30 font-mono">{format(new Date(decision.createdAt), 'HH:mm')}</span>
        </div>

        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className="gap-1.5 text-[10px] font-semibold uppercase tracking-wider bg-background/50 border-border/20 h-7 px-3 py-0 rounded-lg">
              <ActionIcon className="h-3 w-3 opacity-60" />
              {decision.actionType.replace('_', ' ')}
            </Badge>
            <Badge
              variant="secondary"
              className={cn("text-[10px] font-semibold uppercase tracking-wider h-7 px-3 rounded-lg border", colorClass)}
            >
              {decision.decision}
            </Badge>
            <div className="flex items-center gap-1 ml-auto md:hidden">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/30">{format(new Date(decision.createdAt), 'MMM d')}</span>
            </div>
          </div>

          <p className="text-sm font-medium text-foreground/80 leading-relaxed max-w-3xl">
            {decision.reasoning}
          </p>

          <div className="flex items-center gap-6 pt-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/10 border border-border/10">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">Intent</span>
              <span className={cn("text-[10px] font-bold", decision.intentScore > 70 ? "text-emerald-500" : "text-amber-500")}>{decision.intentScore}%</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/10 border border-border/10">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50">Confidence</span>
              <span className="text-[10px] font-bold text-primary">{Math.round((decision.confidence || 0) * 100)}%</span>
            </div>
            <div className="hidden md:flex items-center gap-2 ml-auto">
              <Clock className="h-3 w-3 text-muted-foreground/30" />
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/30">{format(new Date(decision.createdAt), 'MMM d, yyyy')}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function PremiumLoader({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 opacity-80">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      {text && <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider animate-pulse">{text}</p>}
    </div>
  );
}
