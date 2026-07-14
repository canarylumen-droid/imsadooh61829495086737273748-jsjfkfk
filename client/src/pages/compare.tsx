import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navigation } from "@/components/landing/Navigation";
import { Logo } from "@/components/ui/Logo";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
    ChevronDown,
    ChevronRight,
    ArrowRight,
    CheckCircle2,
    XCircle,
    Zap,
    Brain,
    Clock,
    MessageSquare,
    AlertTriangle,
    Target,
    Mic,
    Bot,
    Workflow,
    Mail,
    Calendar,
    TrendingUp,
    ShieldCheck
} from "lucide-react";

// ============================================
// COMPETITOR DATA - 7 TOOLS
// ============================================
const COMPETITORS = [
    {
        id: "manychat",
        name: "ManyChat",
        tagline: "The Bot Trap",
        description: "ManyChat is a popular flow-based chatbot. It's great for basic automation but struggles with complex sales conversations.",
        colorClass: "text-blue-400",
        bgClass: "bg-blue-500/10",
        borderClass: "border-blue-500/20",
        sections: [
            {
                title: "Why ManyChat Falls Short",
                content: `ManyChat was built for engagement, not closing. It uses rigid IF/THEN flows that break the moment a lead says something unexpected. 

The result? Your leads hit dead-ends, get frustrated, and bounce. Meanwhile, you're paying for a tool that can't adapt.

**The Core Problem:** ManyChat treats every conversation like a flowchart. But real sales conversations are fluid, emotional, and unpredictable. A lead might start with "How much?" and pivot to "I'm worried about X" in the same message.`
            },
            {
                title: "ManyChat vs audnixai.com - Feature Comparison",
                type: "comparison",
                items: [
                    { feature: "Conversation Logic", manychat: "IF/THEN Flows", audnix: "AI Intent Detection" },
                    { feature: "Objection Handling", manychat: "Manual Templates", audnix: "110+ Auto-Scenarios" },
                    { feature: "Response Timing", manychat: "Instant (Bot-like)", audnix: "2-8min Humanized Delay" },
                    { feature: "Voice Notes", manychat: "Not Supported", audnix: "AI Voice Cloning" },
                    { feature: "Lead Intent Analysis", manychat: "Keyword Matching", audnix: "Deep Sentiment Analysis" },
                    { feature: "Churn Detection", manychat: "None", audnix: "Predictive Drop-off Alerts" },
                ]
            },
            {
                title: "Real-World Impact",
                content: `**Agencies switching from ManyChat to Audnix report:**

• 47% increase in meeting book rates
• 3.2x more replies from cold leads
• 89% reduction in "dead-end" conversations

The difference isn't just features—it's philosophy. ManyChat automates messages. Audnix closes deals.`
            },
            {
                title: "When ManyChat Makes Sense",
                content: `To be fair, ManyChat works well for:
• Simple FAQ bots
• Basic menu-driven interactions
• Broadcast messaging

But if you're doing high-ticket sales, appointment setting, or complex B2B lead nurturing—you need an AI that thinks, not a bot that follows scripts.`
            }
        ]
    },
    {
        id: "make",
        name: "Make.com",
        tagline: "The Spaghetti Workflow",
        description: "Make.com (formerly Integromat) is powerful but complex. Your sales shouldn't depend on fragile automation chains.",
        colorClass: "text-purple-400",
        bgClass: "bg-purple-500/10",
        borderClass: "border-purple-500/20",
        sections: [
            {
                title: "The Hidden Cost of Complexity",
                content: `Make.com is an incredible tool for developers. But that's the problem—it requires a developer mindset to build anything meaningful.

**The Reality:** Your sales team didn't sign up to debug webhook failures at 2 AM. They want leads in the CRM and meetings on the calendar.

Every Make.com workflow is a tower of technical debt. One API change, one rate limit, one malformed response—and your entire lead engine stops.`
            },
            {
                title: "Make.com vs audnix.com - Architecture",
                type: "comparison",
                items: [
                    { feature: "Setup Time", manychat: "Hours/Days", audnix: "30 Minutes" },
                    { feature: "Technical Skill", manychat: "Developer Required", audnix: "No-Code Setup" },
                    { feature: "Failure Recovery", manychat: "Manual Debug", audnix: "Auto-Retry + Alerts" },
                    { feature: "AI Intelligence", manychat: "None (Just Pipes)", audnix: "Native AI Engine" },
                    { feature: "Lead Context", manychat: "Stateless", audnix: "Full Conversation Memory" },
                    { feature: "Pricing Model", manychat: "Per Operation", audnix: "Per Lead (Unlimited Actions)" },
                ]
            },
            {
                title: "The 'Integration Tax' You're Paying",
                content: `Every Make.com scenario you build has hidden costs:

• **Time Cost:** Hours configuring, testing, debugging
• **Maintenance Cost:** Constant updates when APIs change
• **Opportunity Cost:** Focus on plumbing instead of selling

Audnix handles all of this natively. Instagram, Email, CRM sync—it just works. No webhooks, no JSON parsing, no "I wonder why this broke."

**Make.com saves you time. Audnix makes you money.**`
            }
        ]
    },
    {
        id: "n8n",
        name: "n8n",
        tagline: "The Developer Nightmare",
        description: "n8n is open-source and powerful, but it's a workflow tool—not a sales solution.",
        colorClass: "text-orange-400",
        bgClass: "bg-orange-500/10",
        borderClass: "border-orange-500/20",
        sections: [
            {
                title: "Self-Hosting is a Full-Time Job",
                content: `n8n gives you control. Total control. Including control over server maintenance, security patches, scaling headaches, and 3 AM outages.

**You're not a DevOps team.** You're a sales team. Every hour spent on infrastructure is an hour not spent closing deals.

And when n8n goes down? Your leads aren't waiting. They're moving to your competitors who actually replied.`
            },
            {
                title: "n8n vs audnix.com - Operational Reality",
                type: "comparison",
                items: [
                    { feature: "Hosting", manychat: "Self-Managed", audnix: "Fully Managed Cloud" },
                    { feature: "Reliability", manychat: "You're Responsible", audnix: "Enterprise-Grade" },
                    { feature: "AI Integration", manychat: "Manual (OpenAI Node)", audnix: "Native Brain Engine" },
                    { feature: "Sales Features", manychat: "Build from Scratch", audnix: "Out-of-the-Box" },
                    { feature: "Support", manychat: "Community Forums", audnix: "24/7 Priority Support" },
                    { feature: "Security", manychat: "Your Responsibility", audnix: "Enterprise-Grade Encryption" },
                ]
            },
            {
                title: "The Open-Source Trap",
                content: `Free tools have a hidden price: your time.

n8n users report spending 10-20 hours/month just on maintenance. That's 120-240 hours/year—effectively a part-time job.

Audnix is a premium service because it handles everything. You focus on strategy. We handle the engine.`
            }
        ]
    },
    {
        id: "zapier",
        name: "Zapier",
        tagline: "The Connector, Not the Closer",
        description: "Zapier connects apps. It doesn't close deals. There's a fundamental difference.",
        colorClass: "text-orange-500",
        bgClass: "bg-orange-600/10",
        borderClass: "border-orange-500/20",
        sections: [
            {
                title: "Zapier is Plumbing, Not Sales",
                content: `Zapier is brilliant at one thing: moving data between apps. Lead comes in? Zapier puts it in your CRM. Form submitted? Zapier sends an email.

But Zapier has no concept of:
• What the lead actually wants
• Whether they're ready to buy
• How to handle their objections
• When to follow up

It's a pipe, not a brain. And pipes don't close deals.`
            },
            {
                title: "Zapier vs audnix.com - Sales Capabilities",
                type: "comparison",
                items: [
                    { feature: "Lead Analysis", manychat: "None", audnix: "Deep Intent Scoring" },
                    { feature: "Response Generation", manychat: "None", audnix: "AI-Powered Replies" },
                    { feature: "Follow-up Logic", manychat: "Time-Based Only", audnix: "Behavior + Intent Based" },
                    { feature: "Objection Handling", manychat: "Not Possible", audnix: "110+ Scenarios" },
                    { feature: "Voice Outreach", manychat: "No", audnix: "AI Voice Cloning" },
                    { feature: "Conversion Tracking", manychat: "Manual Setup", audnix: "Automatic Attribution" },
                ]
            },
            {
                title: "The Zap That Doesn't Close",
                content: `**Typical Zapier Sales Workflow:**
1. Lead form → CRM
2. Wait 1 day → Send template email
3. No reply → Send another template
4. Still no reply → Lead dies in your pipeline

**Audnix Sales Workflow:**
1. Lead form → Instant intent analysis
2. AI crafts personalized response based on their message
3. Predictive timing: Sends when they're most likely online
4. No reply? AI detects drop-off risk, deploys re-engagement
5. Lead replies with objection → AI handles it in real-time
6. Intent verified → Auto-books meeting on your calendar

The difference? One is automation. One is intelligence.`
            }
        ]
    },
    {
        id: "instantly",
        name: "Instantly",
        tagline: "The Cold Email Limit",
        description: "Instantly is great for cold email at scale. But email alone isn't enough in 2025.",
        colorClass: "text-sky-400",
        bgClass: "bg-sky-500/10",
        borderClass: "border-sky-500/20",
        sections: [
            {
                title: "Email is Not Dead—But It's Dying",
                content: `Instantly built an empire on cold email. And for good reason: it works. But the landscape is shifting fast.

**The 2025 Reality:**
• Average cold email open rate: 18%
• Average cold email reply rate: 2%
• Average spam filter catch rate: 42%

Meanwhile, Instagram DM reply rates are hitting 35%+. Voice notes? 67% response rate.

Email should be part of your stack. But it shouldn't be your entire stack.`
            },
            {
                title: "Instantly vs audnixai.com - Channel Comparison",
                type: "comparison",
                items: [
                    { feature: "Email Outreach", manychat: "✓ Core Feature", audnix: "✓ Included" },
                    { feature: "Instagram DMs", manychat: "✗ Not Supported", audnix: "✓ Native Integration" },
                    { feature: "Voice Notes", manychat: "✗ Not Supported", audnix: "✓ AI Voice Cloning" },
                    { feature: "Omnichannel Sync", manychat: "Email Only", audnix: "All Channels Unified" },
                    { feature: "Reply AI", manychat: "Basic Templates", audnix: "AI Intent Engine" },
                    { feature: "Booking Integration", manychat: "Manual", audnix: "Auto-Calendly Booking" },
                ]
            },
            {
                title: "The Multi-Channel Advantage",
                content: `**Leads don't live in email.** They're on Instagram. They're watching videos. They respond to voice.

Audnix meets leads where they are:
• Email for formal B2B outreach
• Instagram for warm engagement
• Voice notes for personal touch

And all of it syncs to one unified conversation view. No tab-switching. No lost context. One AI brain handling everything.`
            }
        ]
    },
    {
        id: "smartlead",
        name: "SmartLead",
        tagline: "Volume Without Intelligence",
        description: "SmartLead scales email volume. But volume without intelligence is just expensive noise.",
        colorClass: "text-green-400",
        bgClass: "bg-green-500/10",
        borderClass: "border-green-500/20",
        sections: [
            {
                title: "More Emails ≠ More Sales",
                content: `SmartLead's pitch: Send more emails, get more replies. And mathematically, they're right—to a point.

But here's what they don't tell you:

**The Volume Trap:**
• More emails = Higher spam risk
• Generic templates = Lower reply rates
• No personalization = Lower conversion

You can send 10,000 emails or 1,000 intelligent messages. The 1,000 will outperform every time.`
            },
            {
                title: "SmartLead vs audnixai.com - Quality vs Quantity",
                type: "comparison",
                items: [
                    { feature: "Personalization", manychat: "Variable Merge Tags", audnix: "AI-Generated Custom Copy" },
                    { feature: "Warm-up Strategy", manychat: "Email Warming Only", audnix: "Multi-Channel Warming" },
                    { feature: "Reply Handling", manychat: "Manual Inbox", audnix: "AI Auto-Replies" },
                    { feature: "Lead Scoring", manychat: "Basic", audnix: "Predictive Intent Analysis" },
                    { feature: "Meeting Booking", manychat: "Manual", audnix: "Auto-Pilot Booking" },
                    { feature: "Drop-off Detection", manychat: "None", audnix: "Real-Time Churn Alerts" },
                ]
            },
            {
                title: "From Volume to Value",
                content: `The best sales teams don't send the most emails. They send the right message, to the right person, at the right time.

Audnix's Predictive Timing Algorithm analyzes:
• Lead behavior patterns
• Optimal response windows
• Intent decay curves

Result? Higher open rates, higher reply rates, higher close rates—with lower volume.`
            }
        ]
    },
    {
        id: "highlevel",
        name: "GoHighLevel",
        tagline: "The All-in-One... Overwhelm",
        description: "GoHighLevel does everything. And that's exactly the problem.",
        colorClass: "text-red-400",
        bgClass: "bg-red-500/10",
        borderClass: "border-red-500/20",
        sections: [
            {
                title: "Jack of All Trades, Master of None",
                content: `GoHighLevel is impressive. CRM, funnels, email, SMS, websites, reputation management—it's a Swiss Army knife for agencies.

But when you try to do everything, you rarely do anything exceptionally well.

**Where GHL Falls Short:**
• AI capabilities are bolted-on, not native
• Setup requires extensive training
• Sales automation is workflow-based (like Make.com)
• No true conversational AI for handling objections`
            },
            {
                title: "GoHighLevel vs audnixai.com - Focus Areas",
                type: "comparison",
                items: [
                    { feature: "Primary Focus", manychat: "All-in-One Platform", audnix: "Sales AI Excellence" },
                    { feature: "Learning Curve", manychat: "Weeks to Master", audnix: "30-Minute Setup" },
                    { feature: "AI Intelligence", manychat: "Add-On Feature", audnix: "Core Architecture" },
                    { feature: "Objection Handling", manychat: "Manual Scripts", audnix: "110+ Auto-Scenarios" },
                    { feature: "Voice Notes", manychat: "Limited", audnix: "AI Voice Cloning" },
                    { feature: "Pricing", manychat: "$97-$497/mo", audnix: "From $49.99/mo" },
                ]
            },
            {
                title: "The Integration Option",
                content: `Here's the thing: you don't have to choose one or the other.

Many agencies run Audnix as their **Sales AI layer** alongside GoHighLevel as their **Operations layer**.

• GHL handles: CRM, websites, funnels, reputation
• Audnix handles: Lead qualification, AI follow-ups, objection handling, booking

Best of both worlds. No compromise on sales performance.`
            }
        ]
    }
];

// ============================================
// COMPARISON TABLE COMPONENT
// ============================================
const ComparisonTable = ({ items, competitorName }: { items: any[], competitorName: string }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-left">
            <thead>
                <tr className="border-b border-white/10">
                    <th className="py-4 px-4 text-sm font-bold text-white/60 uppercase tracking-wider">Feature</th>
                    <th className="py-4 px-4 text-sm font-bold text-red-400 uppercase tracking-wider">{competitorName}</th>
                    <th className="py-4 px-4 text-sm font-bold text-emerald-400 uppercase tracking-wider">audnixai.com</th>
                </tr>
            </thead>
            <tbody>
                {items.map((item, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-4 px-4 text-white font-medium">{item.feature}</td>
                        <td className="py-4 px-4 text-white/60">{item.manychat}</td>
                        <td className="py-4 px-4 text-primary font-bold">{item.audnix}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

// ============================================
// CONTENT RENDERER
// ============================================
const ContentRenderer = ({ content }: { content: string }) => {
    const lines = content.split('\n');
    return (
        <div className="space-y-4 text-white/70 leading-relaxed">
            {lines.map((line, i) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                    return <p key={i} className="text-white font-bold text-lg">{line.replace(/\*\*/g, '')}</p>;
                }
                if (line.startsWith('• ')) {
                    return <p key={i} className="flex items-start gap-2"><span className="text-primary">•</span> {line.slice(2)}</p>;
                }
                if (line.startsWith('**') || line.includes('**')) {
                    const parts = line.split(/\*\*(.+?)\*\*/g);
                    return (
                        <p key={i}>
                            {parts.map((part, j) => j % 2 === 1 ? <strong key={j} className="text-white">{part}</strong> : part)}
                        </p>
                    );
                }
                return line.trim() ? <p key={i}>{line}</p> : null;
            })}
        </div>
    );
};

// ============================================
// SECTION ACCORDION
// ============================================
const SectionAccordion = ({ section, competitorName, isOpen, onToggle }: any) => (
    <div className="border border-white/5 rounded-2xl overflow-hidden bg-[#0d1117] mb-4">
        <button
            onClick={onToggle}
            className="w-full p-6 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
        >
            <span className="text-lg font-bold text-white">{section.title}</span>
            <ChevronDown className={`w-5 h-5 text-white/40 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="px-6 pb-6"
                >
                    {section.type === 'comparison' ? (
                        <ComparisonTable items={section.items} competitorName={competitorName} />
                    ) : (
                        <ContentRenderer content={section.content} />
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    </div>
);

// ============================================
// MAIN PAGE
// ============================================
export default function ComparePage() {
    const [activeCompetitor, setActiveCompetitor] = useState(COMPETITORS[0].id);
    const [openSections, setOpenSections] = useState<Record<string, boolean>>({ 0: true });

    const currentCompetitor = COMPETITORS.find(c => c.id === activeCompetitor)!;

    const toggleSection = (index: number) => {
        setOpenSections(prev => ({ ...prev, [index]: !prev[index] }));
    };

    return (
        <div className="min-h-screen bg-black text-white font-sans">
            <Navigation />

            {/* Hero */}
            <section className="pt-32 pb-20 px-6 border-b border-white/5">
                <div className="max-w-7xl mx-auto">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-3xl"
                    >
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-[10px] font-black uppercase tracking-[0.3em] mb-8">
                            <Target className="w-3 h-3" />
                            Competitor Analysis
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-[0.9] mb-8 uppercase">
                            Why Teams Are <br />
                            <span className="text-primary">Switching to Audnix.</span>
                        </h1>
                        <p className="text-xl text-white/50 max-w-xl leading-relaxed">
                            Detailed breakdowns of how audnixai.com compares to popular automation tools. No marketing fluff—just features, facts, and real outcomes.
                        </p>
                    </motion.div>
                </div>
            </section>

            {/* Main Content - Sidebar + Content */}
            <div className="max-w-7xl mx-auto grid lg:grid-cols-[280px_1fr] gap-12 py-16 px-6">

                {/* Sidebar - Tool Tabs */}
                <aside className="lg:sticky lg:top-24 lg:self-start space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-6 px-4">
                        Compare Against
                    </p>
                    {COMPETITORS.map((comp) => (
                        <motion.button
                            key={comp.id}
                            onClick={() => {
                                setActiveCompetitor(comp.id);
                                setOpenSections({ 0: true });
                            }}
                            className={`w-full text-left p-4 rounded-xl flex items-center gap-3 transition-all duration-300 group ${activeCompetitor === comp.id
                                ? `${comp.bgClass} ${comp.borderClass} border`
                                : 'hover:bg-white/5 border border-transparent'
                                }`}
                            whileHover={{ x: activeCompetitor === comp.id ? 0 : 4 }}
                        >
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl font-black ${activeCompetitor === comp.id ? comp.colorClass : 'text-white/40'
                                }`}>
                                {comp.name.charAt(0)}
                            </div>
                            <div>
                                <p className={`font-bold ${activeCompetitor === comp.id ? 'text-white' : 'text-white/60 group-hover:text-white'}`}>
                                    {comp.name}
                                </p>
                                <p className={`text-xs ${activeCompetitor === comp.id ? comp.colorClass : 'text-white/30'}`}>
                                    {comp.tagline}
                                </p>
                            </div>
                            {activeCompetitor === comp.id && (
                                <ChevronRight className={`w-4 h-4 ml-auto ${comp.colorClass}`} />
                            )}
                        </motion.button>
                    ))}
                </aside>

                {/* Main Content */}
                <main className="min-h-screen">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeCompetitor}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            {/* Competitor Header */}
                            <div className={`p-8 rounded-2xl ${currentCompetitor.bgClass} border ${currentCompetitor.borderClass} mb-8`}>
                                <div className="flex items-start justify-between flex-wrap gap-4">
                                    <div>
                                        <h2 className="text-3xl font-black tracking-tight mb-2">{currentCompetitor.name}</h2>
                                        <p className={`text-lg font-bold ${currentCompetitor.colorClass}`}>{currentCompetitor.tagline}</p>
                                    </div>
                                    <Link href="/auth">
                                        <Button className="bg-primary text-black font-black px-6 h-12 rounded-xl text-xs uppercase tracking-widest shadow-[0_0_30px_rgba(0,210,255,0.3)]">
                                            Try Audnix Free <ArrowRight className="ml-2 w-4 h-4" />
                                        </Button>
                                    </Link>
                                </div>
                                <p className="text-white/60 mt-4 max-w-2xl leading-relaxed">
                                    {currentCompetitor.description}
                                </p>
                            </div>

                            {/* Sections */}
                            <div className="space-y-4">
                                {currentCompetitor.sections.map((section, i) => (
                                    <SectionAccordion
                                        key={i}
                                        section={section}
                                        competitorName={currentCompetitor.name}
                                        isOpen={openSections[i]}
                                        onToggle={() => toggleSection(i)}
                                    />
                                ))}
                            </div>

                            {/* CTA */}
                            <div className="mt-12 p-12 rounded-3xl bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 text-center">
                                <h3 className="text-3xl font-black mb-4">Ready to See the Difference?</h3>
                                <p className="text-white/50 mb-8 max-w-xl mx-auto">
                                    Stop paying for tools that save time. Start investing in an AI that makes money.
                                </p>
                                <Link href="/auth">
                                    <Button size="lg" className="bg-primary text-black font-black h-14 px-10 rounded-xl text-sm uppercase tracking-widest shadow-[0_0_40px_rgba(0,210,255,0.4)]">
                                        Deploy Your AI Sales Rep
                                    </Button>
                                </Link>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                </main>
            </div>
        </div>
    );
}
