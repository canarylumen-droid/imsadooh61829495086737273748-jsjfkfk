import { SolutionPageTemplate } from "./SolutionPageTemplate";
import { Sparkles, Zap, Globe, MessageSquare, Wallet, MessageCircle } from "lucide-react";

export default function CreatorsPage() {
    return (
        <SolutionPageTemplate
            title="Monetize Every DM."
            subtitle="For Creators & Personal Brands"
            description="Your DMs are a goldmine, but you can't reply to everyone. Audnix is the AI sales agent that turns your inbox into a 24/7 sales machine that engages fans, qualifies leads, and sells your products. Full lead generation and outreach automation built for creators."
            metrics={[
                { label: "DM Reply Rate", value: "100%", sub: "No Fan Left Behind" },
                { label: "Sales Conversion", value: "18%", sub: "From Cold DM" },
                { label: "Passive Revenue", value: "$15k+", sub: "Avg Monthly Add-on" },
                { label: "Hours Saved", value: "30h", sub: "Weekly Admin Time" },
            ]}
            features={[
                {
                    title: "Smart DM Funnels",
                    desc: "Automatically detect buying intent in DMs. If a fan asks about your course or coaching, Audnix guides them to the checkout page instantly.",
                    icon: MessageCircle
                },
                {
                    title: "Persona Verification",
                    desc: "The AI learns your slang, emojis, and vibe. Fans won't know they're talking to a bot—they'll just feel heard and valued.",
                    icon: Sparkles
                },
                {
                    title: "High-Ticket Closer",
                    desc: "For coaching offers >$1k, the AI acts as an SDR, qualifying the lead's budget and pain points before booking a call for you.",
                    icon: Wallet
                },
            ]}
            useCases={[
                "Selling Digital Products on Autopilot",
                "Booking High-Ticket Coaching calls",
                "Engaging 100% of Fan Replies",
                "Filter Out Time-Wasters Automatically",
                "Upsell Free Followers to Paid Communities"
            ]}
            problemTitle="The Attention Gap"
            problemText={`Attention is not revenue. To turn followers into buyers, you need conversation. 

If you have 100k followers, you get 100+ DMs a day. You have two bad choices: 
1. Spend 5 hours replying manually and burn out. 
2. Ignore them and leave thousands of dollars on the table.

Hiring a VA often breaks the trust because they don't know your voice. Fans can tell when they're talking to a script.

Audnix shatters this ceiling by cloning YOU. We train an intelligence model on your transcripts, tweets, and course content. It learns your slang, emojis, and worldview. It replies to every fan instantly, handles objections, and drops your links when the intent is high.`}
            deepDiveTitle="Brand Persona Engine"
            deepDiveText={`Audnix isn't a chatbot. It's an AI clone of your digital persona.
            
            We ingest your YouTube transcripts, past DM history, and course content to build a 'Knowledge Graph' of your worldview.
            
            When a fan asks a question, the AI doesn't just look up an answer. It constructs a response using your vocabulary, your sentence structure, and your specific teaching style. It even knows when to use emojis or when to be serious.
            
            This allows you to scale 'intimacy'—providing a 1-on-1 feeling to millions of followers simultaneously.`}
            faqs={[
                { question: "Will it sound like a robot?", answer: "No. The system is trained on YOUR specific data (videos, tweets, emails). It mimics your slang, tone, and even your typing style (lowercase vs uppercase, etc)." },
                { question: "Can I take over the chat?", answer: "Yes. The dashboard allows you to jump into any conversation live. The AI will pause immediately when it detects you typing." },
                { question: "Does it work for high-ticket?", answer: "Absolutely. We have specialized modules for high-ticket qualifying. It asks about budget, timeline, and pain points before ever sending a calendar link." },
                { question: "Is it safe for my account?", answer: "Yes. We use official Meta/Instagram APIs. We do not use unsafe scraping or 'login sharing' methods that get accounts banned." },
                { question: "What if it says something wrong?", answer: "You have full control. You can set 'Guardrails' and 'Never-Say' lists. You can also review all logs in real-time." }
            ]}
        />
    );
}
