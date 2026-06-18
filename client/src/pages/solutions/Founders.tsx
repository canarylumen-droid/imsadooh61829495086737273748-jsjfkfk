import { SolutionPageTemplate } from "./SolutionPageTemplate";
import { Users, Target, Zap, Shield, Wallet, Crown } from "lucide-react";

export default function FoundersPage() {
    return (
        <SolutionPageTemplate
            title="Clone Your Best Closer."
            subtitle="For Founders & High-Ticket Sales"
            description="You are the bottleneck. You can't take every call. Audnix clones your sales logic as an AI sales agent so you can stop doing demos for unqualified leads. The best AI sales rep platform for founders who need outreach automation and AI BDR capabilities without hiring."
            metrics={[
                { label: "Calendar Efficiency", value: "100%", sub: "Only Qualified Calls" },
                { label: "Deal Velocity", value: "3x", sub: "Faster Close Rates" },
                { label: "Founder Time", value: "+20h", sub: "Saved Per Week" },
                { label: "Cost vs SDR", value: "-90%", sub: "More Profit" },
            ]}
            features={[
                { title: "Surgical Qualification", desc: "The AI grills leads on budget and timeline before they ever see your calendar link.", icon: Target },
                { title: "Intelligent Closer Logic", desc: "It doesn't just read a script. It uses your past successful calls to navigate complex negotiations.", icon: Crown },
                { title: "Instant Response",                     desc: "Leads are contacted within seconds of interest, drastically increasing conversion rates over human SDRs. The ultimate outreach automation for high-ticket sales.", icon: Zap },
            ]}
            useCases={[
                "Replacing Expensive Sales Reps",
                "Filtering Out 'Tire Kickers'",
                "Reactivating Old Leady Lists",
                "Handling Pricing Objections 24/7",
                "Scaling Offer Testing Rapidly"
            ]}
            problemTitle="The Founder's Bottleneck"
            problemText={`Nobody sells better than the Founder. But you can't take every call.
 
 When you take the call, the close rate is 40%. When you hire a rep, it drops to 15%. Hiring is a nightmare: $10k recruiters, $5k bases, and months of training, only for them to burn leads.
 
 Meanwhile, your calendar is full of 'tire kickers' with $0 budget. You spend your precious time doing unpaid consulting for people who can't afford you.
 
 Audnix clones your sales logic—your best objection handlers, your qualification criteria, and your tone. 

The AI agent sits at the front door. It talks to every lead, asks the hard questions about budget and timeline, and ruthlessly filters out the unqualified. It only puts the 'Hell Yes' leads on your calendar.`}
            deepDiveTitle="The Closing System"
            deepDiveText={`We analyzed over 100,000 successful high-ticket sales conversations to build our AI sales agent 'Closing System' logic.
            
            Unlike alternatives like Instantly or Smartlead that only handle email sequencing, Audnix is a true AI BDR and SDR platform. It drives the conversation using 'Micro-Agreements', 'Labeling', and 'Mirroring' techniques (from Chris Voss negotiation frameworks) to uncover real pain points.
            
            It will respectfully challenge prospects who say 'it's too expensive' by re-anchoring to the cost of inaction. It handles lead generation, qualification, and objection handling automatically.`}
            faqs={[
                { question: "Can it really replace a human?", answer: "For the initial qualification and appointment setting phase: Yes, and often better. For the final closing call on a $10k+ offer, you might still want a human, but Audnix ensures that human only talks to qualified buyers." },
                { question: "What CRMs do you integrate with?", answer: "We integrate natively with HubSpot, Salesforce, GoHighLevel, and Slack. We also have a robust Zapier integration." },
                { question: "How much time does it save?", answer: "Founders typically save 20-30 hours a week by removing themselves from the inbox and initial discovery calls." },
                { question: "Is there a setup fee?", answer: "No. Our self-serve plans allow you to get started instantly. We do offer white-glove onboarding for larger teams." },
                { question: "What if my offer changes?", answer: "You can update the AI's knowledge base in seconds. Just upload a new PDF or edit the text instructions." }
            ]}
        />
    );
}
