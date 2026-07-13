import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, Search, Shield, Zap, CheckCircle2, Bot, MessageCircle, Database, Globe, Mail } from "lucide-react";

export function ProspectionVideo() {
    const [step, setStep] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setStep((prev) => (prev + 1) % 5);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const terminalLines = [
        "> Initializing Audnix System Core v4.0.0...",
        "> Logic: Identify high-pain triggers in Agency sector",
        "> Scanning LinkedIn for \"Founder\", \"CEO\", \"Owner\"...",
        "> Crossing reference with LinkedIn bio sentiment...",
        "> Deep-scanning Website Technology (Missing FB Pixel, Broken Forms)...",
        "> PAIN DETECTED: 2,042 entities bleeding lead-gen ROI",
        "> Starting 12-point Email Verification Process...",
        "> Success. Validated leads moved to high-priority vault."
    ];

    return (
        <div className="w-full max-w-4xl mx-auto mt-12 mb-20 rounded-[2.5rem] bg-card border border-border/40 shadow-[0_0_50px_rgba(0,210,255,0.05)] overflow-hidden relative group">
            <div className="absolute inset-0 bg-primary/5 opacity-20 group-hover:opacity-30 transition-opacity" />

            {/* Header / Title Bar */}
            <div className="px-8 py-5 border-b border-border/10 bg-muted/20 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/40" />
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/30 px-3 py-1 border border-border/10 rounded-full bg-muted/10">
                        AI Prospecting Engine :: LIVE_DEMO
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_10px_#00d2ff]" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">Inference Active</span>
                </div>
            </div>

            <div className="p-8 md:p-12 grid lg:grid-cols-2 gap-12">
                {/* Left side: AI Interaction */}
                <div className="space-y-8">
                    <div className="space-y-6">
                        <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-2xl bg-muted/60 border border-border/40 flex items-center justify-center">
                                <MessageCircle className="w-5 h-5 text-muted-foreground/60" />
                            </div>
                            <div className="flex-1 p-5 rounded-2xl rounded-tl-none bg-muted/40 border border-border/10">
                                <p className="text-sm font-bold text-foreground leading-relaxed">
                                    I need 2,000 leads of agency owners losing money on lead generation and bleeding.
                                </p>
                            </div>
                        </div>

                        <AnimatePresence mode="wait">
                            <motion.div
                                key={step}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="flex items-start gap-4"
                            >
                                <div className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(0,210,255,0.4)]">
                                    <Bot className="w-5 h-5 text-black" />
                                </div>
                                <div className="flex-1 p-5 rounded-2xl rounded-tl-none bg-primary/10 border border-primary/20">
                                    <p className="text-sm font-bold text-primary leading-relaxed">
                                        {step === 0 && "Neutralizing parameters. Scanning for revenue loss indicators..."}
                                        {step === 1 && "Ingesting 15,000+ candidate profiles from LinkedIn..."}
                                        {step === 2 && "Analyzing bio sentiment and website conversion gaps..."}
                                        {step === 3 && "Verifying deliverability for top 2,000 matches..."}
                                        {step === 4 && "2,042 high-pain leads ready for outreach. Initializing vault export."}
                                    </p>
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    {/* Progress Circle & Metrics Section */}
                    <div className="flex items-center gap-8 p-6 rounded-[2rem] bg-muted/30 border border-border/10 relative overflow-hidden">
                        <div className="relative w-20 h-20 flex items-center justify-center">
                            <svg className="w-full h-full -rotate-90">
                                <circle
                                    cx="40"
                                    cy="40"
                                    r="34"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="6"
                                    className="text-muted/10"
                                />
                                <motion.circle
                                    cx="40"
                                    cy="40"
                                    r="34"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="6"
                                    className="text-primary"
                                    strokeDasharray="213.6"
                                    initial={{ strokeDashoffset: 213.6 }}
                                    animate={{ strokeDashoffset: 213.6 - (213.6 * (step + 1) / 5) }}
                                    transition={{ duration: 1, ease: "easeInOut" }}
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center flex-col">
                                <span className="text-lg font-black">{Math.round((step + 1) * 20)}%</span>
                            </div>
                        </div>
                        <div className="flex-1 space-y-2">
                            <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest">
                                <span className="text-muted-foreground/30">Ingestion Velocity</span>
                                <span className="text-primary">821 Leads/sec</span>
                            </div>
                            <div className="h-1.5 w-full bg-muted/20 rounded-full overflow-hidden">
                                <motion.div
                                    animate={{ x: ["-100%", "100%"] }}
                                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                                    className="h-full w-1/2 bg-gradient-to-r from-transparent via-primary to-transparent"
                                />
                            </div>
                            <div className="flex gap-4 pt-1">
                                <div className="space-y-0.5">
                                    <p className="text-[10px] font-black text-foreground">2,042</p>
                                    <p className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-tighter">Verified Leads</p>
                                </div>
                                <div className="w-px h-6 bg-border/20" />
                                <div className="space-y-0.5">
                                    <p className="text-[10px] font-black text-emerald-500">99.8%</p>
                                    <p className="text-[8px] font-bold text-muted-foreground/30 uppercase tracking-tighter">Validity</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right side: Terminal UI */}
                <div className="bg-card/80 rounded-2xl border border-border/20 p-6 font-mono text-[11px] h-full flex flex-col relative overflow-hidden shadow-inner">
                    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] pointer-events-none" />
                    <div className="flex items-center gap-2 mb-4 text-muted-foreground/20 border-b border-border/10 pb-3">
                        <Terminal className="w-3.5 h-3.5" />
                        <span className="font-bold tracking-tighter">bash --audnix-core</span>
                    </div>
                    <div className="flex-1 overflow-hidden space-y-2">
                        {terminalLines.map((line, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: i <= (step * 2 + 1) ? 1 : 0, x: 0 }}
                                transition={{ duration: 0.5 }}
                                className={line.includes("SUCCESS") || line.includes("DETECTOR") || line.includes("Success") ? "text-primary" : "text-white/40"}
                            >
                                {line}
                            </motion.div>
                        ))}
                    </div>

                    <div className="mt-6 p-4 rounded-xl bg-primary/10 border border-primary/20 space-y-3">
                        <div className="flex items-center gap-2">
                            <Shield className="w-3 h-3 text-primary" />
                            <span className="text-[9px] font-black uppercase text-primary tracking-widest">Pain-Verification Process</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[8px] font-bold text-muted-foreground/60">Revenue Leakages Identified</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span className="text-[8px] font-bold text-muted-foreground/60">SDR Ghosting Detection</span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 flex justify-between items-center text-[10px] text-muted-foreground/20">
                        <span>CPU: 42%</span>
                        <span>NET: 1.2 GB/s</span>
                        <span>LATENCY: 12ms</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
