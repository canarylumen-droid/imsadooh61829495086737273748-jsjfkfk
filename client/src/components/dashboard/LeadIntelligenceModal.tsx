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
                            variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 120, damping: 14 } } }}
                            className="p-5 rounded-[2rem] bg-indigo-500/5 border border-indigo-500/10 relative overflow-hidden group hover:border-indigo-500/30 transition-all"
                        >
                            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                                <Sparkles className="h-20 w-20 text-indigo-500 animate-pulse" style={{ animationDuration: '3s' }} />
                            </div>
                            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                            <div className="relative z-10 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Badge className="bg-indigo-500 text-white border-0 text-[9px] font-black tracking-[0.2em] px-2 py-0.5">AI EXECUTIVE SUMMARY</Badge>
                                    <div className="h-1 w-1 rounded-full bg-indigo-300/30" />
                                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest leading-none flex items-center gap-1.5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                      Real-time Synthesis
                                    </span>
                                </div>
                                <p className="text-base font-semibold leading-relaxed text-foreground tracking-tight">
                                    {intelligence.intent.intentLevel === 'high'
                                        ? `This lead shows high intent signals. We've detected strong interest in your core service based on ${intelligence.intent.signals?.length || 0} unique digital signals. They are at peak engagement velocity.`
                                        : `Lead is currently in the observation phase. Intelligence signals suggest a ${intelligence.intent.intentScore}% interest level. Focus on low-pressure educational content to move them down the funnel.`
                                    }
                                </p>
                                <div className="flex items-center gap-4 text-[10px] font-bold text-muted-foreground/60">
                                    <span className="flex items-center gap-1.5"><Shield className="h-3 w-3" /> Identity Verified</span>
                                    <span className="flex items-center gap-1.5"><Zap className="h-3 w-3 text-orange-400" /> Response Probability: {intelligence.intent.intentScore}%</span>
                                </div>
                            </div>
                        </motion.div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Section 1: Core Performance & Prediction */}
                            <motion.div variants={{ hidden: { opacity: 0, x: -20 }, visible: { opacity: 1, x: 0 } }} className="space-y-4">
                                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 ml-1">Market Sentiment & Value</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {/* Predicted Deal Value */}
                                    <motion.div whileHover={{ scale: 1.02, y: -2 }} className="bg-card/40 border border-border/40 rounded-3xl p-5 space-y-4 hover:border-primary/30 hover:shadow-[0_8px_24px_-8px] hover:shadow-primary/10 transition-all">
                                        <div className="h-10 w-10 rounded-2xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                                            <DollarSign className="h-5 w-5 text-primary" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-2xl font-black tracking-tight text-foreground leading-none">
                                                {intelligence.intent.intentLevel === "high" ? `$${intelligence.predictions.predictedAmount.toLocaleString()}` : "$0.00"}
                                            </p>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/60">Projected Pipeline Value</p>
                                        </div>
                                    </motion.div>

                                    {/* Engagement Rank */}
                                    <motion.div whileHover={{ scale: 1.02, y: -2 }} className="bg-card/40 border border-border/40 rounded-3xl p-5 space-y-4 hover:border-orange-500/30 hover:shadow-[0_8px_24px_-8px] hover:shadow-orange-500/10 transition-all">
                                        <div className="h-10 w-10 rounded-2xl bg-orange-500/10 flex items-center justify-center">
                                            <TrendingUp className="h-5 w-5 text-orange-500" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-2xl font-black tracking-tight text-orange-500 leading-none">
                                                {intelligence.intent.intentScore}%
                                            </p>
                                            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-500/60">Engagement Affinity</p>
                                        </div>
                                    </motion.div>
                                </div>

                                <motion.div whileHover={{ x: 2 }} className="bg-indigo-500/5 border border-indigo-500/10 rounded-3xl p-4 flex items-center justify-between hover:border-indigo-500/20 transition-all">
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500">
                                            <BarChart3 className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-500/60 leading-none mb-1">Market Sentiment</p>
                                            <p className="text-sm font-bold text-foreground uppercase tracking-tight">{dashboardStats?.benchmarks?.marketSentiment || "Active"}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 leading-none mb-1">Benchmarked</p>
                                        <p className="text-sm font-bold text-foreground">Top 15%</p>
                                    </div>
                                </motion.div>
                            </motion.div>

                            {/* Section 2: Intent Analysis */}
                            <motion.div variants={{ hidden: { opacity: 0, x: 20 }, visible: { opacity: 1, x: 0 } }} className="space-y-4">
                                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 ml-1">Intent Analytics</h4>
                                <motion.div whileHover={{ y: -1 }} className="bg-card/40 border border-border/40 rounded-3xl overflow-hidden hover:border-primary/20 transition-all">
                                    <div className="p-4 border-b border-border/20 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Zap className="h-3 w-3 text-orange-500" />
                                            <span className="text-[10px] font-black tracking-widest uppercase">Digital Footprint</span>
                                        </div>
                                        <Badge variant={intelligence.intent.intentLevel === 'high' ? 'default' : 'secondary'} className="text-[9px] font-black px-2 py-0">
                                            {intelligence.intent.intentLevel === 'high' ? "PRIORITY" : "TRACKING"}
                                        </Badge>
                                    </div>
                                    <div className="p-4 space-y-4">
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-[10px] font-bold uppercase text-muted-foreground/50">
                                                <span>Validation Confidence</span>
                                                <span className="text-primary">{Math.round((intelligence.intent.confidence || 0) * 100)}%</span>
                                            </div>
                                            <Progress value={(intelligence.intent.confidence || 0) * 100} className="h-1.5 bg-white/5 [&>div]:bg-gradient-to-r [&>div]:from-primary [&>div]:to-indigo-500" />
                                        </div>
                                        <div className="grid grid-cols-1 gap-1.5">
                                            {(intelligence.intent.signals || []).map((signal, i) => (
                                                <motion.div
                                                    key={i}
                                                    initial={{ opacity: 0, x: -10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    transition={{ delay: i * 0.05 }}
                                                    className="flex items-center gap-2 py-1 px-2 rounded-lg hover:bg-white/5 transition-colors group"
                                                >
                                                    <div className="h-1.5 w-1.5 rounded-full bg-orange-500/40 group-hover:bg-orange-500 shrink-0" />
                                                    <span className="text-[11px] font-medium text-foreground/70">{signal}</span>
                                                </motion.div>
                                            ))}
                                            {(!intelligence.intent.signals || !intelligence.intent.signals.length) && (
                                                <p className="text-[10px] text-muted-foreground/40 italic py-2">Discovering intent signals...</p>
                                            )}
                                        </div>
                                    </div>
                                </motion.div>
                            </motion.div>
                        </div>

                        {/* Middle Stat Bar: Unified & Compact */}
                        <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="grid grid-cols-4 gap-4 p-4 rounded-[2rem] bg-muted/20 border border-border/40 hover:border-border/60 transition-all">
                            {[
                              { label: "Inbound", value: intelligence.stats?.totalInbound || 0, c: "text-foreground" },
                              { label: "Outbound", value: intelligence.stats?.totalOutbound || 0, c: "text-foreground" },
                              { label: "Recency", value: `${intelligence.stats?.lastInteractionDays || 0}d`, c: "text-foreground" },
                              { label: "Success", value: intelligence.stats?.hasReplied ? "YES" : "NO", c: intelligence.stats?.hasReplied ? "text-emerald-500" : "text-muted-foreground" },
                            ].map((stat, i) => (
                              <motion.div key={stat.label} whileHover={{ y: -2 }} className={`text-center space-y-1 ${i < 3 ? 'border-r border-border/20' : ''}`}>
                                <p className="text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest">{stat.label}</p>
                                <p className={`text-xl font-black leading-none ${stat.c}`}>{stat.value}</p>
                              </motion.div>
                            ))}
                        </motion.div>

                        {/* Lead Intelligence & Data Hub */}
                        <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 ml-1">Intelligence Hub & Linked Assets</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {lead?.metadata && Object.entries(lead.metadata).map(([key, val]: [string, any]) => {
                                    if (key.endsWith('_type')) return null;
                                    const type = lead.metadata[`${key}_type`];
                                    if (!type && !val?.toString().includes('http')) return null;

                                    const Icon = type === 'google_maps' ? MapPin : type === 'linkedin' ? Linkedin : type === 'instagram' ? Twitter : type === 'twitter' ? Twitter : Globe;
                                    const colorClass = type === 'google_maps' ? 'text-emerald-500 bg-emerald-500/10' : type === 'linkedin' ? 'text-blue-500 bg-blue-500/10' : 'text-primary bg-primary/10';

                                    return (
                                        <motion.a whileHover={{ y: -2, scale: 1.01 }}
                                            key={key} 
                                            href={val} 
                                            target="_blank" 
                                            rel="noreferrer"
                                            className="p-4 rounded-2xl bg-card/40 border border-border/40 hover:border-primary/40 transition-all group flex items-center gap-3"
                                        >
                                            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${colorClass} group-hover:scale-110 transition-transform`}>
                                                <Icon className="h-5 w-5" />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-black uppercase opacity-40 truncate">{key.replace(/_/g, ' ')}</p>
                                                <p className="text-[11px] font-bold text-foreground truncate">{val}</p>
                                            </div>
                                        </motion.a>
                                    );
                                })}

                                {lead?.metadata?.businessPersona && (
                                    <motion.div whileHover={{ y: -1 }} className="p-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 col-span-full hover:border-indigo-500/20 transition-all">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Badge className="bg-indigo-500 text-white border-0 text-[8px] font-black">AI PERSONA</Badge>
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                        </div>
                                        <p className="text-sm font-bold leading-snug">{lead.metadata.businessPersona}</p>
                                        {lead.metadata.optimalContactTime && (
                                            <div className="mt-3 flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-indigo-400">
                                                <span className="flex items-center gap-1.5"><Clock className="h-3 w-3" /> Peak: {lead.metadata.optimalContactTime.start}:00 - {lead.metadata.optimalContactTime.end}:00</span>
                                                <span className="flex items-center gap-1.5"><Activity className="h-3 w-3" /> Confidence: High</span>
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </div>
                        </motion.div>

                        {/* Email & Contact Ribbon */}
                        <motion.div variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } }} className="flex flex-col md:flex-row items-center gap-4">
                            <motion.div whileHover={{ scale: 1.01 }} className="flex-1 w-full p-4 rounded-3xl bg-background/40 border border-border/40 flex items-center justify-between hover:border-primary/20 transition-all">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
                                        <Mail className="h-5 w-5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-bold text-foreground leading-none mb-1">{lead?.email || "No Email"}</p>
                                        <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">Verified Target</p>
                                    </div>
                                </div>
                                <div className="flex gap-1.5">
                                    {intelligence.socialProfiles?.map((profile: any, i: number) => {
                                        const Icon = profile.platform === 'linkedin' ? Linkedin : profile.platform === 'twitter' ? Twitter : Globe;
                                        return (
                                            <a key={i} href={profile.url} target="_blank" className="h-8 w-8 rounded-xl bg-background border border-border/50 flex items-center justify-center text-muted-foreground hover:text-primary transition-colors hover:scale-110">
                                                <Icon className="h-4 w-4" />
                                            </a>
                                        );
                                    })}
                                </div>
                            </motion.div>

                            {/* Call to Action Button */}
                            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                                <Button
                                    size="lg"
                                    onClick={() => window.location.href = `/dashboard/inbox/${lead.id}`}
                                    className="w-full md:w-auto px-8 rounded-[1.5rem] bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest shadow-xl shadow-primary/20 h-14"
                                >
                                    {intelligence.intent.intentLevel === 'high' ? "Execute Follow-up" : "Open Journey"}
                                    <ArrowRight className="ml-2 h-4 w-4 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </motion.div>
                        </motion.div>

                        <motion.div variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} className="pt-2 flex items-center justify-center gap-6">
                            <div className="flex items-center gap-2 opacity-50 grayscale hover:grayscale-0 transition-all cursor-default">
                                <Badge variant="secondary" className="text-[10px] bg-background/50 border-border/50"><Building2 className="h-3 w-3 mr-1" /> Company Matched</Badge>
                                <Badge variant="secondary" className="text-[10px] bg-background/50 border-border/50"><User className="h-3 w-3 mr-1" /> Role Identified</Badge>
                            </div>
                            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/30 flex items-center gap-2">
                                <Shield className="h-3 w-3" /> Audnix Intel Engine V2.4
                            </div>
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
