import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { AlertCircle, Clock, Ghost, TrendingDown, DollarSign, UserX } from "lucide-react";

const PAIN_POINTS = [
    {
        icon: Ghost,
        title: "Response Latency",
        desc: "Businesses lose 70% of potential deals because they can't reply instantly. When a high-ticket lead reaches out, waiting hours to respond means they've already moved to a faster competitor. Speed is the only currency that matters.",
        impact: "Lower Conversion"
    },
    {
        icon: Clock,
        title: "Operational Burnout",
        desc: "You didn't start a business to spend 20+ hours a week manually following up on leads and refreshing your inbox. Manual outreach forces you to work IN your business instead of ON it, capping your growth ceiling.",
        impact: "20+ Hours Lost/Week"
    },
    {
        icon: UserX,
        title: "Process Gaps",
        desc: "Manual follow-ups are inconsistent. Missing critical touchpoints often results in losing high-intent leads that required multiple interactions.",
        impact: "Missing 80% of Sales"
    },
    {
        icon: TrendingDown,
        title: "Lead Interest Decay",
        desc: "Lead intent drops significantly after the first few minutes of contact. Without instant engagement, marketing budgets are underutilized.",
        impact: "Inefficient Spend"
    }
];

export function ProblemSection() {
    const containerRef = useRef<HTMLElement>(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ["start end", "end start"]
    });

    const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
    const scale = useTransform(scrollYProgress, [0, 0.2], [0.95, 1]);

    return (
        <section ref={containerRef} id="problem" className="py-14 md:py-16 px-4 relative overflow-hidden bg-background font-sans">
            <div className="max-w-7xl mx-auto relative z-10">
                <div className="text-center mb-10">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-[0.2em] mb-5"
                    >
                        <AlertCircle className="w-3.5 h-3.5" />
                        The Scaling Trap
                    </motion.div>

                    <motion.h2
                        style={{ opacity, scale }}
                        className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight"
                    >
                        Hidden Efficiency <br />
                        <span className="text-muted-foreground">in your pipeline.</span>
                    </motion.h2>

                    <motion.p
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        className="text-muted-foreground text-base max-w-3xl mx-auto font-medium leading-relaxed"
                    >
                        Most <span className="text-foreground border-b-2 border-primary/20 pb-0.5">Agencies & Creators</span> hit a revenue ceiling because they can't clone themselves. Audnix solves this by deploying autonomous clones that scrape, qualify, and close deals for you.
                    </motion.p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {PAIN_POINTS.map((point, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 30 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            whileHover={{
                                scale: 1.02,
                            }}
                            transition={{ delay: i * 0.1, duration: 0.6 }}
                            className="p-4 rounded-xl bg-card backdrop-blur-xl border border-border/40 hover:border-primary/20 hover:bg-card/80 transition-all group shadow-sm"
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="w-10 h-10 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center text-foreground group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300 shadow-sm">
                                    <point.icon className="w-5 h-5" />
                                </div>
                                <span className="text-[10px] font-black text-foreground/10 group-hover:text-primary/40 transition-colors tracking-widest mt-2">
                                    0{i + 1}
                                </span>
                            </div>
                            <h3 className="text-base font-bold text-foreground mb-2 uppercase">{point.title}</h3>
                            <p className="text-muted-foreground text-xs leading-relaxed mb-4 font-medium">
                                {point.desc}
                            </p>
                            <div className="pt-3 border-t border-border/10 flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30">Performance Impact</span>
                                <span className="text-xs font-bold text-primary">{point.impact}</span>
                            </div>
                        </motion.div>
                    ))}
                </div>

                <motion.div
                    initial={{ opacity: 0, scale: 0.98 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    className="mt-10 p-6 md:p-8 rounded-xl bg-card border border-border/40 text-center relative overflow-hidden group shadow-sm"
                >
                    <div className="absolute inset-0 bg-grid opacity-5" />
                    <div className="relative z-10">
                        <div className="flex flex-col items-center">
                            <div className="p-3 rounded-xl bg-primary/10 mb-6 group-hover:scale-110 transition-transform">
                                <DollarSign className="w-6 h-6 text-primary" />
                            </div>
                            <span className="text-4xl md:text-5xl font-bold text-foreground mb-4">$142,000</span>
                        </div>
                        <p className="text-muted-foreground font-bold uppercase tracking-[0.2em] max-w-2xl mx-auto text-xs md:text-sm leading-relaxed">
                            Mean annual revenue loss for companies with 50+ monthly leads due to <span className="text-foreground font-semibold">manual latency and follow-up errors.</span>
                        </p>
                    </div>
                </motion.div>
            </div>
        </section>
    );
}
