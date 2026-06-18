import { SolutionPageTemplate } from "./SolutionPageTemplate";
import { Users, Database, Globe, Zap, MessageSquare, TrendingUp, ScanSearch, Bot } from "lucide-react";

export default function AgenciesPage() {
    return (
        <SolutionPageTemplate
            title="Scale Without Headcount."
            subtitle="For Growth-Focused Agencies"
            description="Stop hiring expensive VAs to do manual outreach. Audnix deploys autonomous AI sales agents that handle lead generation, outreach automation, and closing for every client in your roster. The best AI sales agent platform for agencies scaling B2B lead generation."
            metrics={[
                { label: "Margin / Client", value: "+40%", sub: "Net Profit Increase" },
                { label: "Manual Labor", value: "-95h", sub: "Hours Saved / Month" },
                { label: "Client Retention", value: "98%", sub: "Through Results" },
                { label: "Meeting Show Rate", value: "2x", sub: "Vs Cold Email" },
            ]}
            features={[
                {
                    title: "Infinite Prospecting Engine",
                    desc: "Don't just wait for leads. Our AI lead generation engine scrapes targeted prospects from LinkedIn and Google Maps tailored to your client's niche. Full outreach automation built in.",
                    icon: ScanSearch
                },
                {
                    title: "White-Label AI Cloning",
                    desc: "Train a unique AI sales agent for each client that perfectly mimics their tone, handles objections, and books meetings. Each client gets their own AI BDR and SDR.",
                    icon: Bot
                },
                {
                    title: "Automated ROI Reporting",
                    desc: "Your clients see the meetings, not the messy middle. Generate automated, white-label performance reports that prove your agency's value.",
                    icon: TrendingUp
                },
            ]}
            useCases={[
                "Automated Cold Outreach for Clients",
                "Instant Lead Qualification & Routing",
                "Reactivating Dead Client Lists",
                "24/7 Response on Weekends & Holidays",
                "Zero-Touch Meeting Booking"
            ]}
            problemTitle="The Churn Trap"
            problemText={`Most agencies stay trapped between $10k and $50k MRR because growth requires headcount. 

Every new client means hiring more SDRs or VAs. SDRs are expensive ($3k-$5k/mo) and prone to inconsistency. VAs often lack the nuance required for high-ticket closing. 

Your payroll swells, but your margins shrink. When a hire makes a mistake or ghosts a lead, your client churns. You're left with a bloated payroll and a shrinking pipeline.

Audnix breaks this cycle with AI sales agents that handle lead generation and outreach automation. 

By deploying autonomous AI agents for B2B lead generation, you decouple revenue from headcount. One manager can oversee 50+ client AI sales reps that never sleep, never forget an objection handling script, and never have a 'bad day'.`}
            deepDiveTitle="Multi-Tenant AI Operations"
            deepDiveText={`Audnix was built for agencies first. Our central dashboard allows you to toggle between 50+ client sub-accounts in seconds.
            
            Each client gets their own isolated 'Brain' (Knowledge Base) and 'Voice' (Style Guide). This means Client A's bot will never talk like Client B's bot.
            
            You can verify ROI with our 'Deterministic Attribution' engine. We track exactly which AI conversation led to a booked meeting or sale, giving you undeniable proof of performance to show your clients.`}
            faqs={[
                { question: "Can I white-label this?", answer: "Yes. The reports and client-facing dashboards can be branded with your agency's logo and domain." },
                { question: "Do I pay per client?", answer: "We have agency volumes packs. The more clients you onboard, the cheaper the per-seat cost becomes." },
                { question: "How fast is onboarding?", answer: "You can spin up a new client agent in about 30 minutes once you have their offer docs and login details." },
                { question: "Does it work for B2B?", answer: "Yes. Our LinkedIn and Email modules are specifically designed for B2B lead generation and appointment setting." },
                { question: "Can it handle complex offers?", answer: "Yes. The AI can be trained on technical specifications, case studies, and complex objection handling trees." }
            ]}
        />
    );
}
