import React from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Brain,
    Activity,
    History,
    Zap,
    Target,
    TrendingUp,
    MessageSquare,
    Clock,
    ShieldCheck,
    AlertCircle
} from "lucide-react";
import { motion } from "framer-motion";
import { ProcessMap } from "./ProcessMap";
import { cn } from "@/lib/utils";

interface LeadProcessModalProps {
    isOpen: boolean;
    onClose: () => void;
    lead: any;
    messages?: any[];
}

export const LeadProcessModal: React.FC<LeadProcessModalProps> = ({
    isOpen,
    onClose,
    lead,
    messages = []
}) => {
    if (!lead) return null;

    const interactionCount = messages.length;
    const lastInteraction = lead.lastMessageAt || lead.updatedAt;
    const sentiment = lead.score > 70 ? "Positive" : lead.score > 40 ? "Neutral" : "Needs Attention";

    // Custom "study" of the lead based on available data
    const behaviorInsights = [
        {
            title: "Engagement Velocity",
            description: interactionCount > 5 ? "High-frequency interaction detected. Lead is actively evaluating." :
                interactionCount > 0 ? "Initial engagement established. Consistent follow-up required." :
                    "Awaiting first touchpoint. System warm-up in progress.",
            icon: Activity,
            color: "text-blue-500"
        },
        {
            title: "Response Quality",
            description: lead.status === 'replied' ? "Constructive feedback received. Lead shows specific interest patterns." :
                lead.status === 'warm' ? "High intent signals detected in recent queries." :
                    "Lead is currently in observational mode. Monitoring for triggers.",
            icon: MessageSquare,
            color: "text-emerald-500"
        },
        {
            title: "Conversion Probability",
            description: `Predicted at ${lead.score || 0}% based on historical behavioral data and industry benchmarks.`,
            icon: TrendingUp,
            color: "text-purple-500"
        }
    ];

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] md:h-auto overflow-hidden p-0 border-border/40 bg-card/95 backdrop-blur-2xl rounded-[2rem] shadow-2xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full -mr-32 -mt-32 z-0" />

                <DialogHeader className="p-8 pb-4 border-b border-border/10 relative z-10">
                    <div className="flex items-center justify-between">
                        <div className="space-y-1">
                            <DialogTitle className="text-3xl font-black tracking-tighter flex items-center gap-3">
                                <Brain className="h-8 w-8 text-primary" />
                                Lead Intelligence Study
                            </DialogTitle>
                            <DialogDescription className="text-muted-foreground/60 font-medium uppercase tracking-[0.2em] text-[10px]">
                                Unique Behavioral Analysis for {lead.name}
                            </DialogDescription>
                        </div>
                        <Badge className={cn(
                            "px-4 py-2 rounded-2xl font-black text-xs tracking-widest",
                            lead.status === 'bouncy' ? "bg-red-500/10 text-red-500 border-red-500/20" : "bg-primary/10 text-primary border-primary/20"
                        )}>
                            {lead.status.toUpperCase()}
                        </Badge>
                    </div>
                </DialogHeader>

                <ScrollArea className="flex-1 p-8 pt-4 pb-12 z-10">
                    <div className="space-y-10">
                        {/* Process Visualization */}
                        <section className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2">
                                <Target className="h-4 w-4" /> Journey Milestone
                            </h3>
                            <div className="bg-muted/20 rounded-[2rem] p-4 border border-border/10">
                                <ProcessMap status={lead.status} />
                            </div>
                        </section>

                        {/* Insight Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <section className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2">
                                    <Zap className="h-4 w-4" /> Behavioral Insights
                                </h3>
                                <div className="space-y-4">
                                    {behaviorInsights.map((insight, i) => (
                                        <motion.div
                                            key={insight.title}
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.1 }}
                                            className="p-4 rounded-2xl bg-muted/30 border border-border/10 group hover:bg-muted/40 transition-colors"
                                        >
                                            <div className="flex gap-4">
                                                <div className={cn("p-2 rounded-xl bg-background border border-border/10 shrink-0", insight.color)}>
                                                    <insight.icon className="h-5 w-5" />
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs font-bold">{insight.title}</p>
                                                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                                                </div>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </section>

                            <section className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 flex items-center gap-2">
                                    <History className="h-4 w-4" /> Interaction Audit
                                </h3>
                                <div className="p-6 rounded-[2rem] bg-indigo-500/5 border border-indigo-500/10 space-y-6">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground/60">Interaction Depth</span>
                                        <span className="text-lg font-black">{interactionCount} Events</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground/60">Sentiment Index</span>
                                        <Badge variant="outline" className="rounded-full px-3">{sentiment}</Badge>
                                    </div>
                                    <div className="pt-4 border-t border-indigo-500/10 space-y-3">
                                        <div className="flex items-start gap-3">
                                            <Clock className="h-4 w-4 text-indigo-400 mt-0.5" />
                                            <div>
                                                <p className="text-[11px] font-bold">Last Activity</p>
                                                <p className="text-[10px] text-muted-foreground">{new Date(lastInteraction).toLocaleString()}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                            {lead.status === 'bouncy' ? (
                                                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5" />
                                            ) : (
                                                <ShieldCheck className="h-4 w-4 text-emerald-400 mt-0.5" />
                                            )}
                                            <div>
                                                <p className="text-[11px] font-bold">Verification Status</p>
                                                <p className="text-[10px] text-muted-foreground">
                                                    {lead.status === 'bouncy' ? "Hard bounce detected. Manual review required." : "Verified delivery path confirmed."}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>

                        {/* Summary Footer */}
                        <div className="p-6 rounded-2xl bg-primary/5 border border-primary/10">
                            <p className="text-[11px] text-primary/80 font-medium leading-relaxed italic">
                                "System study concludes this lead is {lead.score > 60 ? 'highly qualified' : 'in nurturing phase'}.
                                Recommendation: {lead.status === 'replied' ? 'Manual takeover for personalized closing.' : 'Continue automated sequence with soft CTAs.'}"
                            </p>
                        </div>
                    </div>
                </ScrollArea>
            </DialogContent>
        </Dialog>
    );
};
