import { Navigation } from "@/components/landing/Navigation";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Brain, Target, BookOpen, Zap, Shield, MessageSquare, Layers, CheckCircle } from "lucide-react";
import { useEffect } from "react";

const objections = [
  { objection: "It's too expensive", tactic: "ROI Reframe + Social Proof" },
  { objection: "Let me think about it", tactic: "Urgency + Assumed Close" },
  { objection: "Not the right time", tactic: "Timeline Discovery + Fear of Missing" },
  { objection: "I need to talk to my partner", tactic: "Stakeholder Invite + Joint Call" },
  { objection: "We're already using X", tactic: "Competitor Battle Card + Differentiator" },
  { objection: "Send me more info", tactic: "Curiosity Gap + Meeting Anchor" },
  { objection: "I'm not interested", tactic: "Permission + Curiosity Hook" },
  { objection: "Call me next week", tactic: "Calendar Anchor + Commitment" },
];

export default function ObjectionHandlingLanding() {
  useEffect(() => {
    document.title = "AI Objection Handling - Audnix AI | Close More Deals";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-black overflow-x-hidden">
      <Navigation />
      <main className="pt-32">
        <section className="py-16 px-4 relative overflow-hidden">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-500 text-[10px] font-bold uppercase tracking-[0.2em]">
                <Brain className="w-3.5 h-3.5" /> Objection Intelligence
              </motion.div>
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter leading-[0.9]">
                Never Lose a Deal to an <span className="text-primary">Objection Again.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                Audnix handles 110+ objections autonomously using a state machine that tracks each lead's psychology, escalates tactics, and never repeats a failed approach. Train the AI on your specific objections with your custom knowledge base.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/auth">
                  <Button size="lg" className="h-12 px-8 rounded-xl text-sm font-black uppercase tracking-widest bg-primary text-black">
                    Start Closing Objections <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="lg" variant="outline" className="h-12 px-8 rounded-xl text-sm font-black uppercase tracking-widest">
                    View Pricing
                  </Button>
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Objections Library", value: "110+", sub: "Pre-Written Responses" },
                { label: "Lead Profiles", value: "8", sub: "Psychology Types" },
                { label: "Tactic Types", value: "11", sub: "Escalation Strategies" },
                { label: "Custom Training", value: "Yes", sub: "Knowledge Base + FAQs" },
              ].map((m, i) => (
                <div key={i} className="p-6 rounded-2xl bg-card border border-border/40">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{m.label}</p>
                  <p className="text-3xl font-black text-foreground">{m.value}</p>
                  <p className="text-xs text-muted-foreground">{m.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-muted/30 border-y border-border/10">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-3xl font-black text-center mb-4">How Objection Handling <span className="text-primary">Works</span></h2>
            <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-12">The AI uses a state machine that tracks each lead individually — never repeats a failed tactic, escalates intensity when needed, and flags for human takeover if it can't close.</p>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: Layers, title: "State Tracking", desc: "Every lead gets a personal objection state (0-4 intensity). The AI remembers which tactics it tried and whether they worked." },
                { icon: Target, title: "8 Psychology Profiles", desc: "The AI classifies each lead into one of 8 profiles (Fence-sitter, Price-hunter, Authority-seeker, etc.) and tailors responses accordingly." },
                { icon: BookOpen, title: "Custom Training", desc: "Upload your FAQs, brand voice, and custom objection responses. The AI uses your training as highest-priority context in every reply." },
              ].map((s, i) => (
                <div key={i} className="p-6 rounded-2xl bg-card border border-border/40">
                  <s.icon className="w-10 h-10 text-primary mb-4" />
                  <h3 className="text-lg font-bold mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-4">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-black text-center mb-12">Common Objections the AI <span className="text-primary">Handles</span></h2>
            <div className="grid md:grid-cols-2 gap-3">
              {objections.map((o, i) => (
                <div key={i} className="p-4 rounded-xl bg-card border border-border/40 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-foreground">"{o.objection}"</p>
                    <p className="text-xs text-muted-foreground mt-1">{o.tactic}</p>
                  </div>
                  <Shield className="w-8 h-8 text-primary shrink-0 opacity-40" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-4 bg-muted/20 border-y border-border/10">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-black text-center mb-12">Train the AI Your <span className="text-primary">Way</span></h2>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                "Custom FAQ pairs for your specific offers",
                "Brand voice and style guidelines",
                "Custom objection responses for edge cases",
                "Never-say lists to prevent unwanted messaging",
                "Stored securely in S3, injected as high-priority context",
                "Update instantly — no retraining needed"
              ].map((f, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border/40">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-sm text-foreground/80">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-4">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h2 className="text-3xl font-black">Start Closing Every Objection.</h2>
            <p className="text-muted-foreground text-base max-w-lg mx-auto">110+ objections handled autonomously. Zero scripts. Fully personalized to your brand.</p>
            <Link href="/auth">
              <Button size="lg" className="h-12 px-8 rounded-xl text-sm font-black uppercase tracking-widest bg-primary text-black shadow-xl shadow-primary/30">
                Deploy Your AI Closer <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Audnix AI Objection Handling",
          "description": "AI-powered objection handling engine with 110+ pre-written responses, lead psychology tracking, and custom knowledge base training.",
          "brand": { "@type": "Brand", "name": "Audnix AI" },
          "offers": { "@type": "Offer", "price": "29", "priceCurrency": "USD", "availability": "https://schema.org/InStock" }
        })}
      </script>
      <CookieConsent />
    </div>
  );
}
