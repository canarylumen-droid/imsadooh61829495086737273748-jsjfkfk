import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    MessageCircle,
    X,
    Send,
    Bot,
    ChevronDown,
    Minus,
    ArrowUpRight,
    Globe,
    Rocket,
    Sparkles as SparklesIcon,
    Headphones,
    MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/use-user";
import { Link } from "wouter";

interface Message {
    role: 'ai' | 'user';
    content: string;
}

const SUGGESTED_QUESTIONS = [
    { label: "How does it scale?", icon: Globe, query: "How does Audnix scale my client outreach?" },
    { label: "Book a demo", icon: Rocket, query: "How can I book a live demo?" },
    { label: "Pricing", icon: MessageSquare, query: "Tell me about the pricing tiers." },
    { label: "Support", icon: Headphones, query: "How do I contact support?" }
];

// 20 Preset Answers for fallback or common queries
const PRESET_ANSWERS: Record<string, string> = {
    "default": "I am the Super Memory Assistant. I'm here to help you automate your outreach and scale your business with autonomous intelligence. How can I assist you today?",
    "pricing": "Super Memory offers flexible tiers starting from our Base Layer for individuals to Enterprise Solutions. You can view full details in the 'Pricing' section.",
    "demo": "You can initialize a live demo by selecting 'Book a Demo' or by signing up for a free trial to explore the interface directly.",
    "scale": "Super Memory scales by deploying multiple autonomous agents across Email, handling thousands of conversations with zero human latency.",
    "support": "Our technical support team is available 24/7 via the 'Support' link in your dashboard.",
    "how it works": "Super Memory syncs with your brand's communication style, analyzes leads autonomously, handles objections, and books meetings directly into your calendar.",
    "integrations": "Currently, we offer deep integrations with Gmail, Outlook, and custom SMTP.",
    "security": "We use enterprise-grade encryption to ensure every interaction is brand-safe and secure.",
    "leads": "You can import leads via CSV or sync directly from your CRM.",
    "onboarding": "Onboarding takes less than 60 seconds. Simply sync your brand profile and activate the engine.",
    "automation": "Our automation builder allows you to orchestrate human-like follow-up sequences that adapt to prospect sentiment in real-time.",
    "analytics": "The dashboard provides deep analytics on lead scoring, conversion velocity, and agent performance.",
    "setup": "Setup is completely frictionless. No complex coding required—just plug in your communication links and go.",
    "ai assistant": "I am your dedicated Super Memory Assistant, here to provide guidance on all aspects of the platform."
};

const TypingIndicator = () => (
    <div className="flex gap-1.5 p-3 rounded-2xl bg-muted/20 border border-border w-fit">
        {[0, 1, 2].map((i) => (
            <motion.div
                key={i}
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
                className="w-1.5 h-1.5 rounded-full bg-primary"
            />
        ))}
    </div>
);

export function ExpertChat() {
    const [isOpen, setIsOpen] = useState(false);
    const { data: user } = useUser({ enabled: isOpen });
    const [isMinimized, setIsMinimized] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'ai', content: "System initialized. I am the Super Memory Assistant. How can I help you architect your revenue engine today?" }
    ]);
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    // Disabled auto-open to satisfy "work based on user activity" requirement
    /*
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsOpen(true);
        }, 15000);
        return () => clearTimeout(timer);
    }, []);
    */

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isTyping]);

    // Reset conversation when closed (not minimized)
    const handleClose = () => {
        setIsOpen(false);
        setIsMinimized(false);
        // Reset to initial message
        setMessages([
            { role: 'ai', content: "Hello! I am your Super Memory Assistant. I can answer any questions you have about our platform or help you get started. How can I assist you today?" }
        ]);
        setInput("");
    };

    const findPresetAnswer = (query: string) => {
        const lowerQuery = query.toLowerCase();
        for (const key in PRESET_ANSWERS) {
            if (lowerQuery.includes(key)) return PRESET_ANSWERS[key];
        }
        return PRESET_ANSWERS["default"];
    };

    const handleSend = async (customQuery?: string) => {
        const query = customQuery || input;
        if (!query.trim()) return;

        const userMsg: Message = { role: 'user', content: query };
        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setIsTyping(true);

        try {
            const response = await fetch('/api/expert-chat/chat-v2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: query,
                    history: messages.slice(-5),
                    isAuthenticated: !!user
                })
            });

            if (!response.ok) throw new Error("Offline");

            const data = await response.json();
            setIsTyping(false);
            setMessages(prev => [...prev, { role: 'ai', content: data.content }]);
        } catch (error) {
            // Fallback to Preset Answers if API fails
            setTimeout(() => {
                setIsTyping(false);
                const answer = findPresetAnswer(query);
                setMessages(prev => [...prev, { role: 'ai', content: answer }]);
            }, 800);
        }
    };

    return (
        <>
            <AnimatePresence>
                {(!isOpen || isMinimized) && (
                    <motion.button
                        id="expert-chat-trigger"
                        drag
                        dragConstraints={{ left: -window.innerWidth + 80, right: 0, top: -window.innerHeight + 80, bottom: 0 }}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        whileHover={{ scale: 1.1 }}
                        onClick={() => {
                            setIsOpen(true);
                            setIsMinimized(false);
                        }}
                        className="fixed md:bottom-10 md:right-10 bottom-6 right-6 z-[100] w-14 h-14 md:w-16 md:h-16 rounded-full bg-black border-[3px] border-cyan-500 shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all group overflow-hidden hidden sm:flex items-center justify-center cursor-grab active:cursor-grabbing"
                    >
                        {/* Hover Background Glow */}
                        <div className="absolute inset-0 bg-cyan-500 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />

                        <MessageCircle className="w-6 h-6 md:w-7 md:h-7 text-cyan-500 group-hover:text-black transition-colors relative z-10" />
                    </motion.button>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 100, scale: 0.95 }}
                        animate={isMinimized
                            ? { opacity: 1, y: 550, scale: 0.8 }
                            : { opacity: 1, y: 0, scale: 1 }
                        }
                        exit={{ opacity: 0, y: 100, scale: 0.95 }}
                        className="fixed md:bottom-10 md:right-10 bottom-6 right-6 z-[100] w-[380px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[80vh] bg-background rounded-[2rem] shadow-2xl flex flex-col overflow-hidden border border-border"
                    >
                         {/* Header */}
                        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/40 backdrop-blur-md">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-cyan-500/10 flex items-center justify-center text-cyan-500 border border-cyan-500/20">
                                    <SparklesIcon className="w-4 h-4" />
                                </div>
                                <div>
                                    <h4 className="text-foreground font-medium text-sm">Super Memory Assistant</h4>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                        <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-medium">Online</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <button onClick={() => setIsMinimized(!isMinimized)} className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground">
                                    <Minus className="w-4 h-4" />
                                </button>
                                <button onClick={handleClose} className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-transparent">
                            {messages.map((msg, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                                >
                                    <div className={`
                                        max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed
                                        ${msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground rounded-br-sm shadow-md'
                                            : 'bg-muted/30 text-foreground border border-border rounded-bl-sm'}
                                    `}>
                                        {msg.content}
                                    </div>
                                </motion.div>
                            ))}
                            {isTyping && <TypingIndicator />}
                        </div>

                        {/* Suggestions */}
                        {!isTyping && messages.length < 3 && (
                            <div className="px-5 pb-2 flex flex-wrap gap-2">
                                {SUGGESTED_QUESTIONS.map((q) => (
                                    <button
                                        key={q.label}
                                        onClick={() => handleSend(q.query)}
                                        className="px-3 py-1.5 rounded-full bg-muted/30 border border-border text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all flex items-center gap-1.5"
                                    >
                                        <q.icon className="w-3 h-3" />
                                        {q.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Input Area */}
                        <div className="p-4 border-t border-border bg-muted/20 backdrop-blur-md">
                            <div className="flex gap-2 items-center">
                                <input
                                    type="text"
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                                    placeholder="Ask anything..."
                                    className="flex-1 bg-background hover:bg-muted border border-border px-4 h-10 rounded-full text-sm outline-none focus:border-primary/40 transition-all text-foreground placeholder:text-muted-foreground/40"
                                />
                                <button
                                    onClick={() => handleSend()}
                                    disabled={isTyping || !input.trim()}
                                    className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100 shadow-md"
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
