import { motion } from "framer-motion";
import { UserCheck, Zap, MessageSquare, LayoutGrid, Box, Cpu, Share2, Search, Database } from "lucide-react";

const NODES = [
    {
        id: 1, type: "lead", icon: UserCheck, label: "Lead Inbound", sub: "Decision Sync Active", delay: 0,
        stream: ["Identity Verified", "Geo-Tagged", "Intent Scanned"], color: "emerald"
    },
    {
        id: 2, type: "process", icon: LayoutGrid, label: "Data Enrichment", sub: "Vector Processing", delay: 0.2,
        stream: ["LinkedIn Scraped", "Email Guessing...", "Pattern Matched"], color: "blue"
    },
    {
        id: 3, type: "action", icon: MessageSquare, label: "Engagement", sub: "Intelligent Outreach", delay: 0.4,
        stream: ["Tone Synced", "Objection Map", "Sending..."], color: "primary"
    },
    {
        id: 4, type: "result", icon: Zap, label: "Revenue", sub: "Growth System", delay: 0.6,
        stream: ["Meeting Booked", "CRM Synced", "USD Identified"], color: "yellow"
    },
];

const StreamLine = ({ text, delay }: { text: string, delay: number }) => (
    <motion.div
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: [0, 1, 0], x: [0, 10, 20] }}
        transition={{ duration: 2, repeat: Infinity, delay }}
        className="text-[8px] font-black uppercase tracking-tighter text-muted-foreground/20 whitespace-nowrap"
    >
        {text}
    </motion.div>
);

export function DecisionFlowMockup() {
    return (
        <div className="relative w-full min-h-[600px] flex items-center justify-center p-4 md:p-12 group overflow-hidden">
            {/* Background Intelligent Network SVG */}
            <svg className="absolute inset-0 w-full h-full opacity-[0.05] pointer-events-none">
                <pattern id="intelligent-grid" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
                    <circle cx="50" cy="50" r="1" fill="currentColor" />
                    <path d="M 50 50 L 150 50 M 50 50 L 50 150" stroke="currentColor" strokeWidth="0.5" />
                </pattern>
                <rect width="100%" height="100%" fill="url(#intelligent-grid)" />
            </svg>

            {/* Connecting Glow Paths */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-20">
                <div className="w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent relative">
                    <motion.div
                        animate={{ x: ["-100%", "100%"] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-y-0 w-40 bg-gradient-to-r from-transparent via-primary to-transparent shadow-[0_0_20px_rgba(var(--primary),1)]"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative z-10 w-full max-w-7xl">
                {NODES.map((node, i) => (
                    <motion.div
                        key={node.id}
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: node.delay, duration: 0.8 }}
                        className="relative"
                    >
                        <div className={`
                          relative p-8 rounded-[2.5rem] bg-card border border-border/40 backdrop-blur-xl
                          hover:border-primary/40 transition-all duration-700 group/node hover:-translate-y-2
                          shadow-[0_20px_40px_rgba(0,0,0,0.1)]
                        `}>
                            {/* Node Header */}
                            <div className="flex items-start justify-between mb-8">
                                <div className="w-16 h-16 rounded-3xl bg-primary/5 border border-primary/10 flex items-center justify-center text-primary group-hover/node:scale-110 group-hover/node:border-primary/50 transition-all duration-500 shadow-sm">
                                    <node.icon className="w-7 h-7" />
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                                        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground">Live Sync</span>
                                    </div>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/20">Node ID: 0x{node.id}</span>
                                </div>
                            </div>

                            {/* Node Info */}
                            <div className="space-y-4 mb-10">
                                <div className="space-y-1">
                                    <h4 className="text-lg font-black text-foreground tracking-tighter uppercase">{node.label}</h4>
                                    <p className="text-[10px] font-bold text-primary uppercase tracking-widest">{node.sub}</p>
                                </div>

                                {/* Active Logic Stream */}
                                <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-2 overflow-hidden">
                                    {node.stream.map((text, idx) => (
                                        <StreamLine key={idx} text={text} delay={idx * 0.5} />
                                    ))}
                                </div>
                            </div>

                            {/* Node Footer */}
                            <div className="pt-6 border-t border-border/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-6 h-6 rounded-lg bg-foreground/5 flex items-center justify-center">
                                        <Cpu className="w-3 h-3 text-foreground/40" />
                                    </div>
                                    <span className="text-[9px] font-black text-foreground/30 uppercase tracking-[0.2em]">Logic Layer v2.1</span>
                                </div>
                                <Share2 className="w-4 h-4 text-foreground/10" />
                            </div>

                            {/* Animated Pulse Ring */}
                            <div className="absolute -inset-2 bg-primary/5 rounded-[3rem] opacity-0 group-hover/node:opacity-100 animate-pulse -z-10 blur-xl transition-opacity" />
                        </div>
                    </motion.div>
                ))}
            </div>
        </div>
    );
}
