import React, { useState } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion";
import { Navigation } from "@/components/landing/Navigation";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Shield, Zap, Target, AlertTriangle, ChevronDown, MessageSquare } from "lucide-react";
import { CookieConsent } from "@/components/landing/CookieConsent";


interface FAQItem {
    question: string;
    answer: string;
}

interface SolutionPageProps {
    title: string;
    subtitle: string;
    description: string;
    features: { title: string; desc: string; icon: any }[];
    useCases: string[];
    metrics: { label: string; value: string; sub: string }[];
    problemTitle: string;
    problemText: string;
    deepDiveTitle: string;
    deepDiveText: string;
    faqs: FAQItem[];
    heroImage?: string;
}

export function SolutionPageTemplate({
    title,
    subtitle,
    description,
    features,
    useCases,
    metrics,
    problemTitle,
    problemText,
    deepDiveTitle,
    deepDiveText,
    faqs
}: SolutionPageProps) {
    const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

    // Custom text reveal component for scrolling highlights
    const ScrollHighlightText = ({ text, className }: { text: string, className?: string }) => {
        const words = text.split(" ");
        return (
            <p className={className}>
                {words.map((word, i) => (
                    <Word key={i} index={i}>{word} </Word>
                ))}
            </p>
        );
    };

    const Word = ({ children, index }: { children: React.ReactNode, index: number }) => {
        const ref = React.useRef(null);
        const { scrollYProgress } = useScroll({
            target: ref,
            offset: ["start 90%", "start 60%"]
        });
        const opacity = useTransform(scrollYProgress, [0, 1], [0.15, 1]);
        const color = useTransform(scrollYProgress, [0, 1], ["rgba(255,255,255,0.15)", "rgba(255,255,255,1)"]);

        return (
            <motion.span
                ref={ref}
                style={{ opacity, color }}
                whileHover={{
                    color: "#00d2ff",
                    textShadow: "0 0 15px rgba(0, 210, 255, 0.6), 0 0 30px rgba(0, 210, 255, 0.2)",
                    scale: 1.02,
                    y: -1
                }}
                className="transition-all duration-300 px-0.5 inline-block cursor-default font-semibold tracking-tight"
            >
                {children}
            </motion.span>
        );
    };

    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-white">
            <Navigation />

            <main>
                {/* Hero Section */}
                <section className="pt-24 sm:pt-40 pb-16 sm:pb-24 px-4 sm:px-6 relative overflow-hidden">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-primary/5 blur-[150px] rounded-full pointer-events-none -z-10" />

                    <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-20 items-start lg:items-center">
                        <motion.div
                            initial={{ opacity: 0, x: -30 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="space-y-6 sm:space-y-8"
                        >
                            <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-secondary/50 border border-border text-primary text-[10px] font-bold uppercase tracking-[0.3em]">
                                <Target className="w-3 h-3" />
                                {subtitle}
                            </div>
                            <h1 className="text-3xl sm:text-5xl md:text-7xl lg:text-8xl font-black tracking-tighter leading-[0.95] uppercase">
                                {title.split(' ').map((word, i) => (
                                    <span key={i} className={i === title.split(' ').length - 1 ? "text-primary block" : "inline"}>{word} </span>
                                ))}
                            </h1>
                            <ScrollHighlightText
                                text={description}
                                className="text-white/60 text-lg md:text-xl font-medium leading-[1.4] max-w-xl text-left tracking-tight"
                            />

                            <div className="flex flex-wrap gap-4">
                                <Link href="/auth">
                                    <Button size="lg" className="h-14 px-8 rounded-full bg-primary text-black font-black uppercase tracking-widest shadow-[0_0_30px_rgba(0,210,255,0.3)] hover:scale-105 transition-all text-xs">
                                        Get Started <ArrowRight className="ml-2 w-4 h-4" />
                                    </Button>
                                </Link>
                                <Link href="/#calc">
                                    <Button size="lg" variant="outline" className="h-14 px-8 rounded-full border-white/10 bg-white/5 font-black uppercase tracking-widest hover:bg-white/10 transition-all text-white text-xs backdrop-blur-md">
                                        View ROI Model
                                    </Button>
                                </Link>
                            </div>

                            <div className="pt-8 flex items-center gap-8 text-muted-foreground border-t border-white/5">
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40">
                                    <Shield className="w-4 h-4 text-emerald-500" /> Verified Infrastructure
                                </div>
                                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/40">
                                    <Zap className="w-4 h-4 text-primary" /> &lt; 2m Response Latency
                                </div>
                            </div>
                        </motion.div>

                        <div className="grid grid-cols-2 gap-3 sm:gap-6">
                            {metrics.map((metric, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.2 + (i * 0.1) }}
                                    className="p-4 sm:p-6 md:p-8 rounded-[1.5rem] sm:rounded-[2rem] bg-[#0d1117] border border-white/5 hover:border-primary/20 transition-colors group"
                                >
                                    <p className="text-white/20 text-[10px] font-black uppercase tracking-widest mb-1 sm:mb-2">{metric.label}</p>
                                    <p className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tighter mb-1 sm:mb-2 group-hover:text-primary transition-colors">{metric.value}</p>
                                    <p className="text-primary text-[10px] font-black uppercase tracking-widest">{metric.sub}</p>
                                </motion.div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Problem Agitation Section */}
                <section className="py-12 sm:py-20 px-4 sm:px-6 bg-[#030303] border-y border-white/5">
                    <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-8 sm:gap-12 items-start">
                        <div className="space-y-4 sm:space-y-6 lg:sticky lg:top-32">
                            <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-1.5 rounded-full bg-red-500/10 text-red-500 text-[9px] font-black uppercase tracking-[0.4em] shadow-[0_0_20px_rgba(239,68,68,0.2)] border border-red-500/20">
                                <AlertTriangle className="w-3 h-3" />
                                THREAT LEVEL: CRITICAL
                            </div>
                            <h2 className="text-3xl sm:text-4xl md:text-7xl font-black tracking-tighter text-white leading-[0.85] uppercase">{problemTitle}</h2>
                            <p className="text-primary text-[10px] font-black uppercase tracking-[0.3em] opacity-80">
                                Current infrastructure inefficiency detected
                            </p>
                        </div>

                        <div className="pl-4 sm:pl-10 border-l-2 border-primary/20">
                            <ScrollHighlightText
                                text={problemText}
                                className="text-base sm:text-lg md:text-2xl text-white/70 font-bold leading-[1.3] whitespace-pre-line text-left tracking-tight"
                            />
                        </div>
                    </div>
                </section>

                {/* Features Breakdown */}
                <section className="py-16 sm:py-32 px-4 sm:px-6 bg-black">
                    <div className="max-w-7xl mx-auto space-y-12 sm:space-y-20">
                        <div className="text-center space-y-4 sm:space-y-6 max-w-3xl mx-auto mb-8 sm:mb-20">
                            <h2 className="text-2xl sm:text-3xl md:text-6xl font-black tracking-tighter text-white uppercase">Engineered for <span className="text-primary">Dominance.</span></h2>
                            <p className="text-white/40 text-base sm:text-xl font-medium max-w-2xl mx-auto leading-relaxed">
                                Standard outreach is dead. Autonomous intelligence is the only path forward for modern growth engines.
                            </p>
                        </div>

                        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-8">
                            {features.map((feature, i) => (
                                <div key={i} className="p-6 sm:p-10 rounded-[1.5rem] sm:rounded-[2.5rem] bg-[#0d1117] border border-white/5 hover:border-primary/30 transition-all duration-500 space-y-4 sm:space-y-8 group hover:-translate-y-2">
                                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-white group-hover:scale-110 group-hover:bg-primary group-hover:text-black transition-all duration-500">
                                        <feature.icon className="w-6 h-6 sm:w-8 sm:h-8" />
                                    </div>
                                    <div className="space-y-3 sm:space-y-4">
                                        <h3 className="text-lg sm:text-2xl font-black tracking-tight text-white uppercase">{feature.title}</h3>
                                        <p className="text-white/40 text-sm sm:text-base font-medium leading-relaxed">
                                            {feature.desc}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Deep Dive Section */}
                <section className="py-12 sm:py-20 px-4 sm:px-6 border-t border-white/5 bg-[#030303]">
                    <div className="max-w-7xl mx-auto grid md:grid-cols-2 gap-8 sm:gap-16 items-start">
                        <div className="space-y-6 sm:space-y-8 pl-4 sm:pl-10 border-l-2 border-primary/20">
                            <h2 className="text-3xl sm:text-4xl md:text-6xl font-black tracking-tighter text-white uppercase leading-[0.9]">{deepDiveTitle}</h2>
                            <ScrollHighlightText
                                text={deepDiveText}
                                className="text-base sm:text-lg md:text-xl text-white/70 leading-[1.4] whitespace-pre-line font-bold text-left tracking-tight"
                            />
                            <Link href="/auth">
                                <Button variant="ghost" className="rounded-full px-0 font-black uppercase tracking-widest text-[10px] text-primary hover:text-white hover:bg-transparent transition-colors group">
                                    Get Started <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </Button>
                            </Link>
                        </div>
                        <div className="hidden md:flex h-[600px] bg-[#0d1117] rounded-[3rem] border border-white/5 relative overflow-hidden flex-col group shadow-2xl">
                            {/* Pro UI Skeleton Header */}
                            <div className="px-8 py-5 border-b border-white/5 flex items-center justify-between bg-black/20">
                                <div className="flex gap-1.5">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/40" />
                                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="h-1.5 w-24 bg-white/5 rounded-full" />
                                    <div className="h-6 w-6 rounded-full bg-primary/10 border border-primary/20" />
                                </div>
                            </div>

                            {/* Dashboard Skeleton Layout */}
                            <div className="flex-1 flex overflow-hidden">
                                {/* Sidebar Skeleton */}
                                <div className="w-48 border-r border-white/5 p-6 space-y-4">
                                    {[...Array(5)].map((_, i) => (
                                        <div key={i} className="flex items-center gap-3">
                                            <div className="w-4 h-4 rounded bg-white/5" />
                                            <div className={`h-2 bg-white/5 rounded-full ${i === 0 ? 'w-20 bg-primary/20' : 'w-16'}`} />
                                        </div>
                                    ))}
                                    <div className="pt-8 space-y-4">
                                        <div className="h-2 w-12 bg-white/5 rounded-full opacity-50" />
                                        {[...Array(3)].map((_, i) => (
                                            <div key={i} className="flex items-center gap-3">
                                                <div className="w-4 h-4 rounded-full border border-white/5" />
                                                <div className="h-2 w-14 bg-white/5 rounded-full" />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Main Content Skeleton */}
                                <div className="flex-1 p-8 space-y-8 relative">
                                    {/* Grid background */}
                                    <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />

                                    {/* Stats Row */}
                                    <div className="grid grid-cols-3 gap-4">
                                        {[...Array(3)].map((_, i) => (
                                            <div key={i} className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                                                <div className="h-1.5 w-10 bg-white/10 rounded-full" />
                                                <div className="h-4 w-16 bg-white/20 rounded-full" />
                                            </div>
                                        ))}
                                    </div>

                                    {/* Large Graph Block */}
                                    <div className="h-48 rounded-2xl bg-primary/5 border border-primary/10 relative overflow-hidden flex items-center justify-center">
                                        <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                            <svg width="100%" height="100%" viewBox="0 0 400 150">
                                                <motion.path
                                                    d="M0 100 Q 50 20, 100 80 T 200 60 T 300 120 T 400 40"
                                                    fill="none"
                                                    stroke="#00d2ff"
                                                    strokeWidth="3"
                                                    initial={{ pathLength: 0 }}
                                                    whileInView={{ pathLength: 1 }}
                                                    transition={{ duration: 2, ease: "easeInOut" }}
                                                />
                                            </svg>
                                        </div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/60">Platform Active</div>
                                    </div>

                                    {/* List Block */}
                                    <div className="space-y-3">
                                        {[...Array(4)].map((_, i) => (
                                            <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-black/20">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-6 h-6 rounded bg-white/5" />
                                                    <div className="h-2 w-32 bg-white/10 rounded-full" />
                                                </div>
                                                <div className="h-2 w-12 bg-emerald-500/20 rounded-full" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Floating Message Badge */}
                            <motion.div
                                initial={{ y: 20, opacity: 0 }}
                                whileInView={{ y: 0, opacity: 1 }}
                                className="absolute bottom-10 right-10 bg-primary text-black p-4 rounded-2xl shadow-[0_10px_40px_rgba(0,210,255,0.4)] flex items-center gap-3 scale-110"
                            >
                                <MessageSquare className="w-5 h-5" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Lead Verified</span>
                            </motion.div>
                        </div>
                    </div>
                </section>

                {/* FAQ Section */}
                <section className="py-8 sm:py-12 px-4 sm:px-6 bg-muted/10 border-y border-white/5">
                    <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
                        <div className="text-center space-y-1">
                            <h2 className="text-xl md:text-2xl font-black tracking-tight text-white uppercase">Technical FAQs</h2>
                            <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Implementation details</p>
                        </div>
                        <div className="grid gap-2">
                            {faqs.map((faq, i) => (
                                <div key={i} className="rounded-lg border border-white/5 bg-[#0d1117] overflow-hidden hover:border-primary/20 transition-colors">
                                    <button
                                        className="w-full px-5 py-3 text-left flex items-center justify-between font-bold text-white/80 hover:text-white transition-colors"
                                        onClick={() => setOpenFaqIndex(openFaqIndex === i ? null : i)}
                                    >
                                        <span className="text-xs uppercase tracking-tight">{faq.question}</span>
                                        <ChevronDown className={`w-3.5 h-3.5 text-primary transition-transform duration-300 ${openFaqIndex === i ? 'rotate-180' : ''}`} />
                                    </button>
                                    <AnimatePresence>
                                        {openFaqIndex === i && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="px-5 pb-4 text-white/40 leading-relaxed text-xs font-medium whitespace-pre-line border-t border-white/5 pt-3"
                                            >
                                                {faq.answer}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            ))}
                        </div>

                        {/* Support Point */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            className="p-8 rounded-2xl bg-primary/5 border border-primary/10 flex flex-col md:flex-row items-center justify-between gap-6 group"
                        >
                            <div className="text-center md:text-left">
                                <h4 className="text-lg font-bold mb-1">Still need clarity?</h4>
                                <p className="text-white/40 text-xs font-medium">Our strategy team is available 24/7 to help you.</p>
                            </div>
                            <button
                                onClick={() => document.getElementById('expert-chat-trigger')?.click()}
                                className="h-10 px-6 rounded-lg bg-primary text-black font-black uppercase tracking-widest text-[9px] hover:brightness-110 transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95"
                            >
                                <MessageSquare className="w-4 h-4" />
                                Chat with an expert
                            </button>
                        </motion.div>
                    </div>
                </section>

                <section className="py-24 px-6 text-center space-y-6">
                    <h2 className="text-3xl md:text-5xl font-black tracking-tight leading-tight uppercase">Start Your <br /> <span className="text-primary">Evolution.</span></h2>
                    <p className="text-white/40 max-w-lg mx-auto text-sm font-medium">Join the top 1% of agencies and creators who have automated their revenue growth.</p>
                    <Link href="/auth">
                        <Button size="lg" className="h-14 px-10 rounded-full bg-primary text-black font-black uppercase tracking-widest shadow-xl shadow-primary/30 hover:scale-105 transition-all text-xs">
                            Initialize Access
                        </Button>
                    </Link>
                </section>
            </main>

            <CookieConsent />
        </div >
    );
}
