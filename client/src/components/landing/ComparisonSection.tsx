import { motion } from "framer-motion";
import { Check, X, Shield, Zap, Brain, Lock, Server, Cpu, AlertTriangle } from "lucide-react";

const COMPARISON_DATA = [
    {
        feature: "AI Architecture",
        audnix: "Stateful Vector Memory (Pinecone)",
        wrappers: "Stateless Session (Forgets You)",
        humans: "Fragmented Notion Docs",
        icon: Brain
    },
    {
        feature: "Response Latency",
        audnix: "Human-Like (Variable 45s - 5m)",
        wrappers: "Instant (0s - Bot Behavior)",
        humans: "2 - 12 Hours (Sleep/Breaks)",
        icon: Zap
    },
    {
        feature: "Cross-Platform Intel",
        audnix: "Multi-Source Profile Analysis",
        wrappers: "Text-Only Keyword Matching",
        humans: "Manual Scrolling (Slow)",
        icon: Server
    },
    {
        feature: "Safety Standards",
        audnix: "Deterministic Guardrails",
        wrappers: "Prone to Prompt Injection",
        humans: "Emotional/Mood Based Errors",
        icon: Lock
    },
    {
        feature: "Scale Capacity",
        audnix: "Infinite Vertical Scaling",
        wrappers: "API Rate Limit Bottlenecks",
        humans: "Hiring & Training Bottlenecks",
        icon: Cpu
    },
    {
        feature: "Account Safety",
        audnix: "Official Meta API (Green Tick)",
        wrappers: "Unauthorized Scraping (Ban Risk)",
        humans: "Login Sharing (Security Risk)",
        icon: Shield
    }
];

export function ComparisonSection() {
    return (
        <section id="comparison" className="py-40 px-4 bg-background relative overflow-hidden">
            {/* Atmosphere Background */}
            <div className="absolute inset-0 bg-background" />
            <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/5 blur-[150px] rounded-full pointer-events-none" />

            <div className="max-w-7xl mx-auto relative z-10">
                <div className="text-center mb-24 max-w-4xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-[0.3em] mb-8"
                    >
                        <AlertTriangle className="w-3 h-3" />
                        Market Analysis
                    </motion.div>
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-5xl font-black text-foreground tracking-tight leading-[0.9] mb-8"
                    >
                        Why Wrappers <span className="text-destructive">Fail.</span> <br />
                        Why Humans <span className="text-destructive">Burn Out.</span>
                    </motion.h2>
                    <p className="text-muted-foreground text-xl font-medium leading-relaxed">
                        The market is flooded with "AI Tools" that are just simple ChatGPT wrappers. They lack memory, safety, and nuanced timing. Audnix is an Operating System, not a tool.
                    </p>
                </div>

                <div className="overflow-x-auto pb-8">
                    <table className="w-full text-left border-collapse min-w-[1000px]">
                        <thead>
                            <tr>
                                <th className="py-8 px-6 text-[10px] uppercase tracking-[0.2em] text-foreground/30 font-bold border-b border-border/10">Core Capability</th>
                                <th className="py-8 px-6 text-[10px] uppercase tracking-[0.2em] text-destructive/80 font-bold border-b border-border/10 bg-destructive/5">Generic AI Wrappers</th>
                                <th className="py-8 px-6 text-[10px] uppercase tracking-[0.2em] text-orange-500/80 font-bold border-b border-border/10 bg-orange-500/5">Human VAs / SDRs</th>
                                <th className="py-8 px-6 text-[10px] uppercase tracking-[0.2em] text-primary font-bold border-b border-border/10 bg-primary/5 border-t-2 border-t-primary relative">
                                    <div className="absolute top-0 left-0 right-0 h-32 bg-primary/10 blur-[60px] -z-10" />
                                    Audnix System
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {COMPARISON_DATA.map((row, i) => (
                                <motion.tr
                                    key={i}
                                    initial={{ opacity: 0, x: -20 }}
                                    whileInView={{ opacity: 1, x: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.1 }}
                                    className="border-b border-white/5 group hover:bg-white/[0.02] transition-colors"
                                >
                                    <td className="py-8 px-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-10 h-10 rounded-xl bg-foreground/5 flex items-center justify-center text-foreground/40 group-hover:text-foreground transition-colors border border-border/10">
                                                <row.icon className="w-5 h-5" />
                                            </div>
                                            <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">{row.feature}</span>
                                        </div>
                                    </td>
                                    <td className="py-8 px-6">
                                        <div className="flex items-center gap-3 text-white/40 font-medium text-sm">
                                            <X className="w-4 h-4 text-red-500" />
                                            {row.wrappers}
                                        </div>
                                    </td>
                                    <td className="py-8 px-6">
                                        <div className="flex items-center gap-3 text-white/40 font-medium text-sm">
                                            <X className="w-4 h-4 text-orange-500" />
                                            {row.humans}
                                        </div>
                                    </td>
                                    <td className="py-8 px-6 bg-primary/[0.02]">
                                        <div className="flex items-center gap-3 text-white font-bold text-sm shadow-[0_0_20px_rgba(var(--primary),0.2)] inline-block px-4 py-2 rounded-lg bg-primary/10 border border-primary/20">
                                            <Check className="w-4 h-4 text-primary" />
                                            {row.audnix}
                                        </div>
                                    </td>
                                </motion.tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="mt-20 grid md:grid-cols-2 gap-8">
                    <div className="p-10 rounded-[2.5rem] bg-card border border-border/40 relative overflow-hidden shadow-sm">
                        <div className="relative z-10">
                            <h3 className="text-2xl font-bold text-foreground mb-4">The "Wrapper" Trap</h3>
                            <p className="text-muted-foreground leading-relaxed font-medium">
                                Most tools are just accessing OpenAI's API directly. This means they have no "state". If a lead asks a question, the bot forgets who they are in the next message. Audnix maintains a persistent "Identity Layer" for every lead.
                            </p>
                        </div>
                    </div>
                    <div className="p-10 rounded-[2.5rem] bg-primary/5 border border-primary/20 relative overflow-hidden shadow-sm">
                        <div className="relative z-10">
                            <h3 className="text-2xl font-bold text-foreground mb-4">The Human Error Factor</h3>
                            <p className="text-muted-foreground leading-relaxed font-medium">
                                Humans have bad days. They get tired, they misread tones, and they forget to follow up. Audnix is deterministic. It never forgets a follow-up, never gets angry, and never sleeps.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
