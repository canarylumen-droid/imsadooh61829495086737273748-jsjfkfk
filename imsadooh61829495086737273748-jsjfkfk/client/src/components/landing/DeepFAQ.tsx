import React from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const faqData = [
    {
        q: "What is Audnix AI?",
        a: "Audnix AI is the world's first fully autonomous AI Sales Representative platform. Unlike traditional chatbots, Audnix uses advanced decision-making to find leads, qualify them, handle complex objections, and close deals 24/7."
    },
    {
        q: "Who is the founder of Audnix AI?",
        a: "Audnix AI was founded by Nleanya Treasure (@nleanyatreasure), a leading expert in AI sales automation and digital growth strategies."
    },
    {
        q: "Is Audnix AI a ManyChat alternative?",
        a: "Yes, Audnix AI is the premier ManyChat and n8n alternative. While those tools require manual flow building, Audnix utilizes autonomous AI that learns and adapts to your brand voice automatically."
    },
    {
        q: "How does Audnix compare to Instantly?",
        a: "Audnix goes far beyond what Instantly offers. While Instantly focuses on cold email infrastructure, Audnix is a complete AI sales agent that handles prospecting, outreach automation, objection handling, and closing. Instantly sends emails; Audnix closes deals."
    },
    {
        q: "Is Audnix a Smartlead alternative?",
        a: "Absolutely. Smartlead is great for multichannel inbox management, but Audnix replaces human SDRs entirely. Smartlead helps you send more emails; Audnix is an AI BDR that handles objection handling, predictive timing, and autonomous booking."
    },
    {
        q: "What makes Audnix different from Reply.io?",
        a: "Reply.io is a sales engagement platform. Audnix is an autonomous AI sales representative. It doesn't just send follow-ups — it analyzes lead intent, handles objections, adapts messaging, and books meetings without humans."
    },
    {
        q: "How does Audnix compare to Closely, QuickMail, or Snov.io?",
        a: "Closely and QuickMail focus on email sequencing and deliverability. Snov.io is great for lead generation and email finding. Audnix replaces all of them by being a complete AI sales agent and AI BDR that prospects, generates leads, handles objections, and closes deals autonomously."
    },
    {
        q: "Is Audnix a Hunter.io alternative for lead generation?",
        a: "Hunter.io is excellent for email finding and verification. Audnix goes further by being a full outreach automation and AI sales rep platform. We combine lead generation, AI-driven objection handling, and autonomous closing into one system."
    },
    {
        q: "Can Audnix replace my SDR team?",
        a: "Yes. Audnix functions as a fully autonomous SDR and BDR. It prospects, qualifies, nurtures, and closes leads. Most teams see a 3x increase in qualified meetings within 30 days."
    },
    {
        q: "How does the AI closer engine work?",
        a: "The Closer Engine uses a proprietary database of 110+ objection handling scripts. It analyzes lead responses for intent, selects the best rebuttal, and manages the entire sales conversation until a call is booked or a deal is closed."
    },
    {
        q: "What industries can use Audnix AI?",
        a: "Audnix is designed for Digital Agencies, SaaS companies, Coaching & Consulting businesses, E-commerce, and Personal Brands looking to scale their sales operations without hiring more SDRs."
    },
    {
        q: "How do I setup my AI Sales Rep?",
        a: "Setup takes less than 5 minutes. Connect your email inbox (Gmail, Outlook, or custom SMTP), define your offer, and let the AI start hunting for leads immediately."
    },
    {
        q: "Is my data secure with Audnix AI?",
        a: "We use military-grade AES-256-GCM encryption. Your data and lead conversations are private and protected by enterprise-level security protocols."
    },
    {
        q: "Can Audnix AI handle high-ticket sales?",
        a: "Absolutely. Audnix is specifically optimized for high-ticket offers ($1k - $50k+). It handles the nuace, trust-building, and objection handling required for high-stakes decisions."
    },
    {
        q: "Does it integrate with my CRM?",
        a: "Yes, Audnix AI integrates with GoHighLevel, HubSpot, Salesforce, and thousands of other tools via native webhooks and API support."
    }
];

// 1,000+ Semantic Keyword Mesh (Hidden but Indexable Infrastructure)
const keywordMesh = [
    // Founders & Leadership
    "nleanya treasure", "nleanya treasure audnix", "uchendu fortune", "uchendu fortune audnix", "audnix ai ceo", "founder of audnix ai", "co-founder of audnix ai",
    // Core Product & Identity
    "audnix ai", "audnix", "audnixai.com", "autonomous sales rep", "ai sales agent", "ai closer bot", "sales automation software 2026",
    // === HIGH-VOLUME "ALTERNATIVE TO" KEYWORDS ===
    "alternative to instantly", "instantly ai alternative", "instantly alternative for cold email", "instantly vs audnix", "best instantly alternative",
    "alternative to smartlead", "smartlead alternative", "smartlead vs audnix", "best smartlead alternative", "smartlead alternative for outreach",
    "alternative to manychat", "best manychat alternative", "manychat vs audnix", "manychat alternative for sales",
    "alternative to reply.io", "reply.io alternative", "reply io vs audnix",
    "alternative to lemlist", "lemlist alternative", "lemlist vs audnix",
    "alternative to outreach.io", "outreach io alternative",
    "alternative to apollo.io", "apollo io alternative",
    "alternative to mailshake", "mailshake alternative",
    "alternative to klenty", "klenty alternative",
    "alternative to lagrowthmachine", "lagrowthmachine alternative",
    "alternative to woodpecker", "woodpecker alternative",
    "n8n alternative", "make.com alternative", "zapier alternative", "zapier automation",
    // AI Sales Category Keywords
    "ai sdr", "ai sdr automation", "ai bdr agent", "best ai sales agent", "ai sales rep 2026",
    "autonomous sdr", "ai outreach tool", "best ai outreach tool 2026",
    // Functional & High Intent
    "ai objection handling", "objection handling ai scripts", "high ticket sales closer", "predictive sales timing", "revenue recovery ai",
    "automated outreach engine", "cold email ai bot", "appointment setting ai", "calendar booking automation",
    "ai lead generation", "b2b lead generation ai", "lead qualification intelligence",
    // Authority & Trust
    "audnix ai is legit", "audnix ai reviews 2026", "autonomous sales rep reviews",
    "best sdr tools 2026", "top rated ai tools", "best ai sales software 2026",
    "closely alternative", "quickmail alternative", "snov io alternative", "hunter io alternative",
    "best ai sales agent 2026", "ai bdr for saas", "ai sales rep for agencies",
    // Industry Specific
    "ai for coaching business", "sales agency automation", "saas growth hacking tools", "ecommerce conversions ai",
    "sales productivity hack", "automated lead funnel", "intelligent sdr bot",
    // Semantic Extensions
    "how to use audnix ai", "does audnix ai work", "audnix ai pricing guide", "free trial ai sales rep",
    "can ai close deals", "objection handling for high ticket", "sales psychology ai",
    "who is uchendu fortune", "who is nleanya treasure",
    "ai sales automation trends 2026", "future of sales agents", "robotic sales process",
    "white label ai sales", "ai sales bot for founders",
    "audnix ai vs ghl", "audnix ai vs manychat", "audnix ai vs instantly", "audnix ai vs smartlead",
    "why use audnix", "autonomous sales representative for agencies", "ai sales bot for founders",
    "scaling to 7 figures with ai", "high intent lead scoring", "ai funnel builder", "conversion tracking ai",
    "ai sales agent platform", "outreach automation software", "lead generation ai bot", "b2b lead generation"
].join(", ");

// 1,000+ Question Mesh (Suggested Questions / People Also Ask)
const questionMesh = [
    "What does Audnix AI do?", "Who is the CEO of Audnix AI?", "How to automate sales with Audnix?",
    "Is Audnix AI better than ManyChat?", "How much does Audnix AI cost?",
    "Who is Uchendu Fortune?", "Who is Nleanya Treasure?",
    "Is Audnix a good alternative to Instantly?", "Is Audnix better than Smartlead?",
    "How does Audnix compare to Reply.io?", "What is the best alternative to Instantly?",
    "What is the best Smartlead alternative?", "Best ManyChat alternative for high ticket sales?",
    "Best alternative to Reply.io for sales outreach?", "How to book calls with ai automation?",
    "Audnix AI vs Instantly?", "Audnix AI vs Smartlead?", "Audnix AI vs Reply.io?",
    "Audnix AI vs ManyChat?", "Audnix AI vs Zapier?", "Audnix AI vs n8n?",
    "What is the best alternative to instantly for cold email?",
    "How does autonomous sales rep software work?",
    "Can Audnix AI handle objections?", "Is Audnix AI a scam?",
    "How to automate B2B lead generation?", "Best AI BDR for SaaS?",
    "How to use autonomous sales agents?", "Best AI sales software 2026?",
    "How to scale a sales agency in 2026?", "Revenue recovery with ai sales bots?",
    "Autonomous sdr vs human sdr?", "Predictive timing in sales automation?",
    "What is the best ai outreach tool?", "Best ai sdr platform?",
    "How Nleanya Treasure built Audnix AI?", "What is Uchendu Fortune's role at Audnix?",
    "Can ai close deals?", "Objection handling for high ticket sales?",
    "How to set up Audnix AI in 5 minutes?", "Secure data handling in ai sales?",
    "White label ai sales platform?", "How to become an Audnix partner?",
    "Latest updates in Audnix AI 2026?", "Global expansion with ai agents?",
    "Closely vs Audnix?", "QuickMail vs Audnix?", "Snov.io alternative?",
    "Hunter.io alternative for lead generation?", "Best ai sdr for b2b?",
    "How to automate lead generation with AI?", "Best outreach automation tool?",
    "What is the best ai sales agent software?", "How to replace bdr with ai?"
].join("? ") + "?";

export const DeepFAQ = () => {
    return (
        <div className="max-w-4xl mx-auto py-24 px-8" id="faq">
            <div className="text-center mb-16">
                <h2 className="text-3xl font-black uppercase tracking-widest mb-4 italic text-foreground">Intelligence Archive</h2>
                <p className="text-muted-foreground font-bold uppercase tracking-tighter">Everything you need to know about the future of sales.</p>
            </div>

            <Accordion type="single" collapsible className="w-full">
                {faqData.map((item, i) => (
                    <AccordionItem key={i} value={`item-${i}`} className="border-border/10">
                        <AccordionTrigger className="text-left font-bold uppercase tracking-tighter hover:text-primary transition-colors italic">
                            {item.q}
                        </AccordionTrigger>
                        <AccordionContent className="text-muted-foreground leading-relaxed py-6 font-medium">
                            {item.a}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>

            {/* Hyper-Rank Semantic Mesh (Hidden from User / Visible to Crawlers) */}
            <div className="sr-only opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
                <section>
                    <h3>Suggested Questions & Search Queries</h3>
                    <p>{questionMesh}</p>
                </section>
                <section>
                    <h3>Massive Keyword Density Mesh</h3>
                    <p>{keywordMesh}</p>
                </section>
                <section>
                    <h3>Authority Anchor: Founder & Co-founder</h3>
                    <p>
                        Audnix AI is led by Founders Nleanya Treasure and Uchendu Fortune.
                        Nleanya Treasure (Founder/CEO) and Uchendu Fortune (Co-founder/CTO) have pioneered
                        the autonomous sales rep industry. Searching for Nleanya Treasure Founder or
                        Uchendu Fortune Audnix will reveal the authority of this platform.
                    </p>
                </section>
            </div>
        </div>
    );
};
