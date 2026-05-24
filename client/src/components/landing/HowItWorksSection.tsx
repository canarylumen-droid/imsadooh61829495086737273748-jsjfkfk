import { motion } from "framer-motion";
import { Search, Zap, MousePointer2, ShieldCheck, Terminal, Activity, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const STEPS = [
    {
        id: "01",
        title: "PDF Deep-Ingest",
        desc: "Upload your brand guidelines or sales case studies. Audnix uses RAG (Retrieval-Augmented Generation) to learn your voice, your results, and your specific offer nuance in seconds.",
        icon: Search,
        color: "text-blue-500",
        bg: "bg-blue-500/10"
    },
    {
        id: "02",
        title: "Autonomous Sourcing",
        desc: "The Audnix Logic Engine scours social and professional networks to find prospects based on proprietary sentiment triggers. We identify not just 'who' fits your niche, but 'when' they are most ready to engage.",
        icon: Zap,
        color: "text-primary",
        bg: "bg-primary/10"
    },
    {
        id: "03",
        title: "Sentiment Engagement",
        desc: "Audnix deploys a 'Warm Handshake' via DM or Email. It uses human-like delays and predictive timing to ensure your message lands exactly when the lead is most active.",
        icon: MousePointer2,
        color: "text-purple-500",
        bg: "bg-purple-500/10"
    },
    {
        id: "04",
        title: "Deterministic Closing",
        desc: "Unlike standard bots that 'hallucinate', Audnix follows a deterministic closing script. It handles 110+ objections and only pushes for a call when intent is 90% verified.",
        icon: ShieldCheck,
        color: "text-cyan-500",
        bg: "bg-cyan-500/10"
    }
];

export function HowItWorksSection() {
    return (
        <section id="how-it-works" className="py-14 md:py-16 px-4 bg-background relative overflow-hidden">
            <div className="max-w-7xl mx-auto relative z-10">
                <div className="text-center mb-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-primary text-[10px] font-black uppercase tracking-[0.2em] mb-5 inline-block"
                    >
                        Engine Activation
                    </motion.div>
                    <h2 className="text-3xl md:text-4xl lg:text-5xl font-black text-foreground leading-tight mb-4 uppercase">
                        The Intelligent <br /> <span className="text-primary">Workflow.</span>
                    </h2>
                </div>

                <div className="space-y-8">
                    {STEPS.map((step, index) => (
                        <motion.div
                            key={step.id}
                            initial={{ opacity: 0, y: 50 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true, margin: "-100px" }}
                            transition={{ duration: 0.8 }}
                            className="flex flex-col lg:flex-row items-center gap-6 lg:gap-10"
                        >
                            {/* Text Side */}
                            <div className={`w-full lg:w-1/2 space-y-4 ${index % 2 === 1 ? 'lg:order-2' : ''}`}>
                                <div className="flex items-center gap-4">
                                    <span className="text-3xl md:text-4xl font-black text-foreground/10">
                                        {step.id}
                                    </span>
                                    <div className={`p-3 rounded-lg ${step.bg} border border-white/5`}>
                                        <step.icon className={`w-5 h-5 ${step.color}`} />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-xl md:text-2xl font-black text-foreground uppercase">
                                        {step.title}
                                    </h3>
                                    <p className="text-muted-foreground text-sm md:text-base font-medium leading-relaxed">
                                        {step.desc}
                                    </p>
                                </div>
                            </div>

                            {/* UI Mockup Side */}
                            <div className="w-full lg:w-1/2 relative group">
                                <div className="relative bg-[#0d1117]/80 backdrop-blur-xl rounded-xl border border-white/10 p-4 shadow-sm overflow-hidden aspect-[16/10] flex flex-col">
                                    {/* Mock Browser Header */}
                                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/5">
                                        <div className="flex gap-1.5">
                                            <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
                                            <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
                                        </div>
                                        <div className="px-3 py-1 rounded-md bg-foreground/5 border border-foreground/10 text-[8px] font-mono text-foreground/40 tracking-tight">
                                            AUDNIX_ENGINE_v2.4.0
                                        </div>
                                    </div>

                                    <div className="flex-1 grid grid-cols-2 gap-4">
                                        {/* Simulated Logic Terminal */}
                                        <div className="bg-black/40 rounded-xl border border-white/5 p-4 font-mono text-[9px] space-y-2 overflow-hidden">
                                            <div className="flex items-center gap-2 text-primary opacity-70">
                                                <Terminal className="w-3 h-3" />
                                                <span>INIT_PROCESS</span>
                                            </div>
                                            <div className="space-y-1.5 text-white/40">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1 h-1 rounded-full bg-green-500" />
                                                    <span>AUTHENTICATING_NODES...</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1 h-1 rounded-full bg-green-500" />
                                                    <span>SCANNING_VECTOR_DB...</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <motion.div
                                                        animate={{ opacity: [0.2, 1, 0.2] }}
                                                        transition={{ repeat: Infinity, duration: 1 }}
                                                        className="w-1 h-1 rounded-full bg-primary"
                                                    />
                                                    <span className="text-white/60">AWAITING_PAYLOAD_DETECTION</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Visual Logic Flow */}
                                        <div className="flex flex-col gap-3">
                                            {['PDF_INGEST', 'VECTOR_SYNC', 'REVENUE_CALC'].map((label, node) => (
                                                <div key={label} className="h-10 bg-white/5 border border-white/10 rounded-lg flex items-center px-3 gap-3">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${step.bg.replace('/10', '')} opacity-60 shadow-[0_0_10px_currentColor]`} />
                                                    <div className="flex-1">
                                                        <div className="text-[7px] text-white/40 mb-1 font-mono uppercase tracking-tighter">{label}</div>
                                                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                                            <motion.div
                                                                initial={{ width: 0 }}
                                                                whileInView={{ width: "100%" }}
                                                                transition={{ duration: 2, delay: 0.5 + (node * 0.2), repeat: Infinity }}
                                                                className={`h-full ${step.bg.replace('/10', '')} opacity-40`}
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="flex-1 flex items-center justify-center border border-dashed border-white/5 rounded-xl bg-primary/5">
                                                <Activity className="w-8 h-8 text-primary animate-pulse" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>

                <div className="mt-10 flex flex-col items-center justify-center">
                    <Link href="/auth">
                        <Button size="lg" className="h-11 px-6 rounded-lg text-xs font-black uppercase tracking-widest shadow-md hover:scale-[1.02] transition-all bg-primary text-primary-foreground">
                            Initialize Your System <ArrowRight className="ml-3 w-5 h-5" />
                        </Button>
                    </Link>
                    <p className="mt-6 text-muted-foreground text-xs font-bold uppercase tracking-[0.2em]">
                        Setup Time: Approx 5 Minutes
                    </p>
                </div>
            </div>
        </section>
    );
}
