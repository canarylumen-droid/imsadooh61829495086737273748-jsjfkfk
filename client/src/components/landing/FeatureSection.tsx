import { motion } from "framer-motion";
import { Mic, BrainCircuit, Clock, AlertTriangle, Zap, Search, ArrowRight } from "lucide-react";

interface FeatureCardProps {
    title: string;
    description: string;
    icon: any;
    delay: number;
    index: number;
}

const FeatureCard = ({ title, description, icon: Icon, delay, index }: FeatureCardProps) => (
    <motion.div
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay, duration: 0.6 }}
        className="group relative h-full rounded-xl glass-premium p-4 hover:bg-white/[0.05] transition-all duration-300"
    >
        <div className="relative z-10">
            <div className="flex justify-between items-start mb-4">
                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 group-hover:bg-primary group-hover:text-black transition-all duration-300">
                    <Icon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-black text-foreground/10 group-hover:text-primary/40 transition-colors tracking-widest mt-2">
                    0{index + 1}
                </span>
            </div>
            <h3 className="text-base font-black text-foreground mb-2 uppercase">{title}</h3>
            <p className="text-muted-foreground text-xs leading-relaxed font-medium">
                {description}
            </p>
        </div>
    </motion.div>
);

export function FeatureSection() {
    return (
        <section id="features" className="py-14 md:py-16 px-4 bg-background relative overflow-hidden">
            <div className="max-w-7xl mx-auto relative z-10">
                <div className="text-center mb-10">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        className="px-4 py-1.5 rounded-full bg-white/5 border border-white/10 text-primary text-[10px] font-black uppercase tracking-[0.2em] mb-5 inline-block shadow-sm"
                    >
                        Built for Performance
                    </motion.div>
                    <motion.h2
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-4xl lg:text-5xl font-black text-foreground leading-tight mb-4 uppercase"
                    >
                        Engineered <br /> To <span className="text-primary italic">Win.</span>
                    </motion.h2>
                    <p className="text-muted-foreground text-base font-medium max-w-2xl mx-auto leading-relaxed">
                        Generic AI chats are toys. Audnix is an autonomous revenue engine that analyzes, strategizes, and closes.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 px-4 relative z-10 mb-6">
                    <FeatureCard
                        title="Voice Note Intelligence"
                        description="Audnix doesn't just read text. It listens to Voice Notes, extracts sentiment, and adapts its reply tone instantly using advanced acoustic modeling."
                        icon={Mic}
                        delay={0}
                        index={0}
                    />
                    <FeatureCard
                        title="Real-Time Intent Check"
                        description="Every reply is analyzed against 110+ objection scenarios and buying signals before a single word is sent back to the lead."
                        icon={BrainCircuit}
                        delay={0.1}
                        index={1}
                    />
                    <FeatureCard
                        title="Predictive Timing"
                        description="Uses 'Human-Like Delays' (2-8 mins) and checks user activity to respond exactly when they are most likely to convert into a sale."
                        icon={Clock}
                        delay={0.2}
                        index={2}
                    />
                    <FeatureCard
                        title="Churn & Drop-off Risk"
                        description="Identifies leads losing interest based on sentiment decay and automatically deploys a 'Re-Engagement System' to recover the sale."
                        icon={AlertTriangle}
                        delay={0.3}
                        index={3}
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-4 relative z-10">
                    <div className="lg:col-span-2 group relative overflow-hidden rounded-xl glass-premium p-4 md:p-6">
                        <div className="relative z-10">
                            <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 mb-4 transition-transform duration-300">
                                <Zap className="w-5 h-5 text-primary" />
                            </div>

                            <h3 className="text-xl md:text-2xl font-black mb-3 uppercase text-foreground">
                                High-Ticket Closer Engine
                            </h3>

                            <p className="text-muted-foreground font-medium text-sm mb-5 max-w-xl leading-relaxed">
                                Most bots just answer questions. Audnix is programmed to
                                <span className="text-foreground"> close the deal</span>.
                                It systematically overcomes objections, builds value, and pushes for the meeting only when intent is verified.
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {[
                                    "110+ Objection Scenarios",
                                    "Qualified Meetings Only",
                                    "Price-Sensitivity Analysis",
                                    "Competitor Awareness"
                                ].map((item, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm font-bold text-white/60">
                                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="group relative overflow-hidden rounded-xl glass-premium p-4 md:p-6">
                        <div className="relative z-10 h-full flex flex-col justify-between">
                            <div>
                                <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 mb-4 transition-transform duration-300">
                                    <Search className="w-5 h-5 text-primary" />
                                </div>
                                <h3 className="text-xl font-black mb-3 uppercase text-foreground">Smart Lead Profile</h3>
                                <p className="text-muted-foreground text-sm font-medium leading-relaxed mb-4">
                                    Audnix scans public data to build a profile of every lead before engaging.
                                </p>
                            </div>

                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    {["URGENT", "ENTERPRISE", "PRICE SENSITIVE", "STARTUP", "AGENCY", "HIGH INTENT"].map((tag, i) => (
                                        <span key={i} className="px-3 py-1 bg-primary/5 border border-primary/10 rounded-full text-[10px] font-black uppercase tracking-wider text-muted-foreground group-hover:border-primary/20 group-hover:text-foreground transition-colors cursor-default">
                                            {tag}
                                        </span>
                                    ))}
                                </div>

                                <div className="pt-4 border-t border-border/10">
                                    <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
                                        <span>Buying Intent</span>
                                        <span className="text-primary">High (92%)</span>
                                    </div>
                                    <div className="h-1 w-full bg-primary/10 rounded-full overflow-hidden">
                                        <div className="h-full bg-primary w-[92%]" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
