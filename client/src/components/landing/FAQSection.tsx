import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { Plus, Minus, MessageCircle, HelpCircle, Sparkles, Orbit, ChevronDown } from "lucide-react";

const FAQS = [
    {
        question: "Is this just another AI wrapper?",
        answer: "No. Audnix is an infrastructure-first engagement engine. We bypass standard chat interfaces to integrate directly with your sales logic, ensuring every response is backed by your brand's specific historical context and strategic goals."
    },
    {
        question: "How do you protect my brand's reputation?",
        answer: "Precision is our priority. We use triple-layer validation: Tone Synchronization, Fact-checking against your Knowledge Base, and Confidence Thresholds. If the AI isn't 100% certain, it escalates to you instantly."
    },
    {
        question: "Can I jump into conversations personally?",
        answer: "Seamlessly. Audnix is designed to augment you, not replace you. You can take over any lead with a single click, and the AI will pause, observing your style to better assist you in the future."
    },
    {
        question: "How fast will I see a return on investment?",
        answer: "Most teams see an immediate drop in response latency (from hours to seconds) and a 30-40% increase in lead-to-meeting conversion within the first 14 days of typical Intelligence Flow deployment."
    },
    {
        question: "Is my data encrypted and secure?",
        answer: "We use enterprise-grade AES-256 encryption for all brand data. Your lead lists and interaction history are isolated, never used for training third-party models, and fully compliant with global data privacy standards."
    }
];

export function FAQSection() {
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    return (
        <section id="faq" className="py-40 px-4 relative bg-background overflow-hidden">
            {/* Background Decorative */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-primary/5 blur-[200px] rounded-full pointer-events-none" />

            <div className="max-w-4xl mx-auto relative z-10">
                <div className="text-center mb-32">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        className="flex items-center justify-center gap-3 mb-8"
                    >
                        <div className="p-2 rounded-xl bg-primary/5 border border-primary/10 text-primary">
                            <Orbit className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/40">Knowledge Base</span>
                    </motion.div>
                    <motion.h2
                        initial={{ opacity: 0, y: 30 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-5xl lg:text-6xl font-black tracking-tight text-foreground mb-10 leading-[0.95]"
                    >
                        Strategic <br />
                        <span className="text-foreground/40">Inquiries.</span>
                    </motion.h2>
                    <p className="text-muted-foreground font-medium text-lg max-w-2xl mx-auto leading-relaxed">
                        Architecting the future of <span className="text-foreground">autonomous market dominance.</span>
                    </p>
                </div>

                <div className="space-y-4">
                    {FAQS.map((faq, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: i * 0.1 }}
                            className={`rounded-3xl border transition-all duration-500 overflow-hidden ${openIndex === i ? "bg-card border-primary/20 shadow-xl" : "bg-card/30 border-border/40 hover:border-primary/10"
                                }`}
                        >
                            <button
                                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                                className="w-full px-10 py-10 flex items-center justify-between text-left group"
                            >
                                <div className="flex items-center gap-8">
                                    <div className={`w-2 h-2 rounded-full transition-all duration-500 ${openIndex === i ? "bg-primary scale-125 shadow-[0_0_10px_rgba(var(--primary),0.5)]" : "bg-muted-foreground/20"}`} />
                                    <span className={`text-xl md:text-2xl font-bold tracking-tight transition-colors duration-300 ${openIndex === i ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                                        {faq.question}
                                    </span>
                                </div>
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all duration-500 ${openIndex === i ? "bg-primary border-primary text-primary-foreground rotate-180 shadow-lg shadow-primary/20" : "bg-transparent border-border/40 text-muted-foreground"
                                    }`}>
                                    <ChevronDown className="w-5 h-5" />
                                </div>
                            </button>

                            <AnimatePresence>
                                {openIndex === i && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                    >
                                        <div className="px-10 pb-12 text-muted-foreground text-base md:text-lg leading-relaxed font-medium max-w-3xl ml-10">
                                            <div className="w-12 h-px bg-primary/20 mb-8" />
                                            {faq.answer}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    ))}
                </div>

                {/* Support Point */}
                <motion.div
                    initial={{ opacity: 0, y: 40 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="mt-24 p-12 rounded-3xl bg-primary/5 border border-primary/10 flex flex-col md:flex-row items-center justify-between gap-10 group relative overflow-hidden"
                >
                    <div className="text-center md:text-left relative z-10">
                        <h4 className="text-2xl font-bold text-foreground mb-3">Still need clarity?</h4>
                        <p className="text-muted-foreground font-medium text-sm">Our strategy team is available 24/7 to help you <span className="text-foreground font-bold underline">architect your flow</span>.</p>
                    </div>
                    <button
                        onClick={() => document.getElementById('expert-chat-trigger')?.click()}
                        className="relative z-10 h-14 px-10 rounded-xl bg-primary text-primary-foreground font-bold uppercase tracking-widest text-[10px] hover:brightness-110 transition-all duration-300 flex items-center gap-3 shadow-lg shadow-primary/10 active:scale-95"
                    >
                        <MessageCircle className="w-5 h-5 font-bold" />
                        Chat with an expert
                    </button>
                    {/* Decorative Flare */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 blur-[80px] rounded-full -mr-20 -mt-20 group-hover:bg-primary/20 transition-colors duration-700" />
                </motion.div>
            </div>
        </section>
    );
}
