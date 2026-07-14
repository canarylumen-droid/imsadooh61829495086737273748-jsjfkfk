import { motion } from "framer-motion";
import { X, Check, Activity, Zap, Clock, Shield, Target, Smartphone, AlertOctagon } from "lucide-react";

export function MoatSection() {
    return (
        <section className="py-32 px-4 relative overflow-hidden bg-background">
            <div className="max-w-7xl mx-auto relative z-10">
                <div className="text-center mb-24">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6"
                    >
                        Performance Edge <br />
                        <span className="text-primary">over templates.</span>
                    </motion.h2>
                </div>

                <div className="grid md:grid-cols-2 gap-8 items-stretch">
                    {/* Traditional Bots */}
                    <motion.div
                        initial={{ opacity: 0, x: -50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="p-10 rounded-3xl border border-border/40 bg-muted/20 opacity-60 grayscale hover:grayscale-0 transition-all flex flex-col h-full"
                    >
                        <div className="flex items-center gap-4 mb-8">
                            <div className="w-12 h-12 rounded-2xl bg-muted border border-border/50 flex items-center justify-center">
                                <X className="w-6 h-6 text-muted-foreground" />
                            </div>
                            <h3 className="text-xl font-bold text-muted-foreground uppercase tracking-widest">Generic Automation</h3>
                        </div>

                        <ul className="space-y-6 flex-1">
                            {[
                                "Replies instantly (Super-human speed = Bot)",
                                "Misses context in long threads",
                                "Can't handle complex objections (Price/Time)",
                                "Spams calendar links to unqualified leads",
                                "Zero awareness of drop-off risk"
                            ].map((text, i) => (
                                <li key={i} className="flex items-start gap-4 text-muted-foreground/60 font-medium">
                                    <X className="w-4 h-4 text-destructive/40 mt-1 flex-shrink-0" />
                                    <span className="text-sm">{text}</span>
                                </li>
                            ))}
                        </ul>
                    </motion.div>

                    {/* audnixai.com */}
                    <motion.div
                        initial={{ opacity: 0, x: 50 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        className="relative"
                    >
                        <div className="p-10 rounded-3xl border border-primary/20 bg-primary/5 h-full transition-all hover:bg-primary/[0.08]">
                            <div className="flex items-center gap-4 mb-8">
                                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center border border-primary/30">
                                    <Shield className="w-6 h-6 text-primary" />
                                </div>
                                <h3 className="text-xl font-bold text-foreground uppercase tracking-widest">High-Ticket Closer Engine</h3>
                            </div>

                            <ul className="space-y-6">
                                {[
                                    { icon: Target, t: "Qualified Meetings Only", d: "No tire-kickers. AI verifies budget & intent before booking." },
                                    { icon: Activity, t: "110+ Objection Handling", d: "Handles price, timing, and partner objections automatically." },
                                    { icon: Clock, t: "Predictive Follow-up Timing", d: "Sends messages when leads are statistically most active." },
                                    { icon: AlertOctagon, t: "Drop-off & Churn Detection", d: "Identifies fading interest and triggers re-engagement loops." },
                                    { icon: Smartphone, t: "Voice Cloning & Notes", d: "Sends authentic voice messages that sound exactly like you/brand." }
                                ].map((item, i) => (
                                    <motion.li
                                        key={i}
                                        initial={{ opacity: 0, y: 10 }}
                                        whileInView={{ opacity: 1, y: 0 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: i * 0.1 }}
                                        className="flex items-start gap-4 text-foreground group"
                                    >
                                        <div className="w-6 h-6 mt-1 flex-shrink-0">
                                            <item.icon className="w-full h-full text-primary group-hover:scale-110 transition-transform" />
                                        </div>
                                        <div>
                                            <span className="block font-bold text-sm uppercase tracking-wider">{item.t}</span>
                                            <span className="text-muted-foreground text-xs font-medium leading-relaxed">{item.d}</span>
                                        </div>
                                    </motion.li>
                                ))}
                            </ul>
                        </div>
                    </motion.div>
                </div>
            </div>
        </section>
    );
}
