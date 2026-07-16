import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    BarChart3,
    Brain,
    Building2,
    CheckCircle2,
    Clock,
    DollarSign,
    Mail,
    Shield,
    Sparkles,
    Target,
    TrendingUp,
    User,
    Zap,
    Linkedin,
    Twitter,
    Globe,
    MapPin,
} from "lucide-react";

import { PremiumLoader } from "@/components/ui/premium-loader";

interface IntelligenceData {
    lead_id: string;
    intent: {
        intentLevel: "high" | "medium" | "low";
        intentScore: number;
        confidence: number;
        signals: string[];
        buyerStage?: string;
        reasoning?: string;
    };
    predictions: {
        predictedAmount: number;
        expectedCloseDate?: string;
        confidence: number;
    };
    churnRisk: {
        churnRiskLevel: "high" | "medium" | "low";
        indicators: string[];
        recommendedAction?: string;
    };
    nextBestAction: string;
    suggestedActions?: string[];
    actionContext?: {
        calendarLink?: string;
        ctaLink?: string;
    };
    stats?: {
        totalInbound: number;
        totalOutbound: number;
        lastInteractionDays: number;
        hasReplied: boolean;
    };
    socialProfiles?: Array<{
        platform: string;
        url: string;
    }>;
}


interface Message {
    id: string;
    body: string;
    direction: "inbound" | "outbound";
    createdAt: string;
    metadata?: Record<string, unknown>;
}

interface LeadIntelligenceModalProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    lead: any;
}

export function LeadIntelligenceModal({ isOpen, onOpenChange, lead }: LeadIntelligenceModalProps) {
    // First fetch real message history for this lead
    const { data: messagesData } = useQuery<{ messages: Message[] }>({
        queryKey: ["/api/messages", lead?.id, { limit: 100, offset: 0, integrationId: lead?.integrationId }],
        enabled: isOpen && !!lead?.id,
        retry: false,
    });

    // Fetch global benchmarks to compare this lead against
    const { data: dashboardStats } = useQuery<any>({
        queryKey: ["/api/dashboard/stats"],
    });

    // Then fetch real AI intelligence analysis using actual messages
    const { data: intelligence, isLoading, refetch } = useQuery<IntelligenceData>({
        queryKey: ["/api/leads/intelligence/intelligence-dashboard", lead?.id],
        queryFn: async () => {
            const messages = messagesData?.messages || [];

            // Transform messages to the format expected by the AI
            const conversationMessages = messages.map(m => ({
                direction: m.direction,
                body: m.body,
                createdAt: m.createdAt,
                metadata: m.metadata,
            }));

            const response = await fetch("/api/leads/intelligence/intelligence-dashboard", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    lead: {
                        id: lead.id,
                        firstName: lead.name?.split(" ")[0] || "Lead",
                        name: lead.name || "Unknown",
                        company: lead.company || "",
                        email: lead.email || "",
                        industry: lead.industry || lead.metadata?.industry || "",
                        phone: lead.phone || "",
                        metadata: lead.metadata || {},
                        userId: lead.userId,
                    },
                    messages: conversationMessages
                }),
            });
            if (!response.ok) throw new Error("Failed to fetch intelligence");
            return response.json();
        },
        enabled: isOpen && !!lead && !!messagesData,
        retry: false,
    });

    // Refetch intelligence when messages load
    useEffect(() => {
        if (messagesData?.messages && isOpen) {
            refetch();
        }
    }, [messagesData, isOpen, refetch]);

    const getScoreColor = (score: number) => {
        if (score >= 80) return "text-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.5)]";
        if (score >= 50) return "text-amber-500";
        return "text-amber-500/50";
    };

    const getRiskColor = (risk: string) => {
        if (risk === "high") return "text-red-500 bg-red-500/10 border-red-500/20";
        if (risk === "medium") return "text-amber-500 bg-amber-500/10 border-amber-500/20";
        return "text-primary bg-primary/10 border-primary/20";
    };

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[90dvh] overflow-y-auto bg-gradient-to-br from-background to-muted/20 border-border/60 p-4 sm:p-6">
                <DialogHeader className="pb-4 border-b border-border/40">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/30">
                            <Brain className="h-6 w-6" />
                        </div>
                        <div>
                            <DialogTitle className="text-xl">Lead Overview</DialogTitle>
                            <DialogDescription>
                                AI-generated analysis for <span className="font-semibold text-foreground">{lead?.name}</span>
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {isLoading ? (
                    <div className="py-20 flex flex-col items-center justify-center space-y-4">
                        <PremiumLoader text="Analyzing lead patterns..." />
                        <p className="text-sm text-muted-foreground">Checking intent signals, email reputation, and conversion probability.</p>
                    </div>
                ) : intelligence ? (
                    <motion.div
                      initial="hidden"
                      animate="visible"
                      variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
                      className="space-y-6 pt-2"
                    >
                        {/* Executive AI Summary / Key Takeaway */}
                    <motion.div
                        variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }}
                        className="p-4 rounded-2xl bg-muted/30 border border-border/40"
                    >
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-[9px] font-semibold px-2 py-0.5">Lead Intelligence</Badge>
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  Real-time
                                </span>
                            </div>
                            <p className="text-sm leading-relaxed text-foreground">
                                {intelligence.intent.intentLevel === 'high'
                                    ? `${intelligence.intent.signals?.length || 0} engagement signals detected — lead is actively evaluating.`
                                    : `Lead is in observation phase (${intelligence.intent.intentScore}% interest).`}
                            </p>
                            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
                                <span>Response Probability: {intelligence.intent.intentScore}%</span>
                                <span>Signals: {intelligence.intent.signals?.length || 0}</span>
                            </div>
                        </div>
                    </motion.div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="p-4 rounded-2xl bg-background/40 border border-border/40">
                                <p className="text-[10px] text-muted-foreground/50 mb-1">Predicted value</p>
                                <p className="text-xl font-bold">
                                    {intelligence.intent.intentLevel === "high" ? `$${intelligence.predictions.predictedAmount.toLocaleString()}` : "$0"}
                                </p>
                            </div>
                            <div className="p-4 rounded-2xl bg-background/40 border border-border/40">
                                <p className="text-[10px] text-muted-foreground/50 mb-1">Engagement</p>
                                <p className="text-xl font-bold text-orange-500">{intelligence.intent.intentScore}%</p>
                            </div>
                        </div>

                        {/* Stats Bar */}
                        <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-2xl bg-muted/20 border border-border/40">
                            {[
                              { label: "Inbound", value: intelligence.stats?.totalInbound || 0 },
                              { label: "Outbound", value: intelligence.stats?.totalOutbound || 0 },
                              { label: "Recency", value: `${intelligence.stats?.lastInteractionDays || 0}d` },
                              { label: "Replied", value: intelligence.stats?.hasReplied ? "Yes" : "No" },
                            ].map((stat, i) => (
                              <div key={stat.label} className="text-center space-y-0.5">
                                <p className="text-[10px] text-muted-foreground/50">{stat.label}</p>
                                <p className={`text-lg font-bold ${i === 3 && stat.value === "Yes" ? "text-emerald-500" : ""}`}>{stat.value}</p>
                              </div>
                            ))}
                        </motion.div>

                        {lead?.metadata && Object.entries(lead.metadata).filter(([k]) => !k.endsWith('_type')).some(([, v]) => v?.toString().includes('http')) && (
                            <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="flex flex-wrap gap-2">
                                {Object.entries(lead.metadata).map(([key, val]: [string, any]) => {
                                    if (key.endsWith('_type')) return null;
                                    if (!val?.toString().includes('http')) return null;
                                    const type = lead.metadata[`${key}_type`];
                                    let href = val;
                                    if (type === 'google_maps') href = `https://maps.google.com/?q=${encodeURIComponent(val)}`;
                                    if (key === 'linkedin') href = val.startsWith('http') ? val : `https://linkedin.com/in/${val}`;
                                    return (
                                        <a key={key} href={href} target="_blank" rel="noreferrer"
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted/30 border border-border/30 text-[10px] hover:bg-muted/60 transition-colors">
                                            <Globe className="h-3 w-3" />
                                            {key.replace(/_/g, ' ')}
                                        </a>
                                    );
                                })}
                            </motion.div>
                        )}

                        {/* Contact & Action */}
                        <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                            <div className="flex-1 p-3 rounded-2xl bg-background/40 border border-border/40 flex items-center justify-between">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="text-sm truncate">{lead?.email || "No Email"}</span>
                                </div>
                                <div className="flex gap-1 shrink-0 ml-2">
                                    {intelligence.socialProfiles?.map((profile: any, i: number) => {
                                        const Icon = profile.platform === 'linkedin' ? Linkedin : Globe;
                                        return (
                                            <a key={i} href={profile.url} target="_blank" className="h-7 w-7 rounded-lg bg-background border border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground">
                                                <Icon className="h-3.5 w-3.5" />
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>
                            <Button
                                size="sm"
                                onClick={() => window.location.href = `/dashboard/inbox/${lead.id}`}
                                className="shrink-0 rounded-xl"
                            >
                                {intelligence.intent.intentLevel === 'high' ? "Follow up" : "View journey"}
                                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                        </motion.div>

                        <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} className="pt-2 flex items-center justify-center gap-3">
                            <span className="text-[10px] text-muted-foreground/40">Audnix Intelligence</span>
                        </motion.div>

                    </motion.div>
                ) : (
                    <div className="py-12 text-center text-muted-foreground">
                        <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-50" />
                        No intelligence data available yet.
                    </div>
                )}
            </DialogContent>
        </Dialog >
    );
}
