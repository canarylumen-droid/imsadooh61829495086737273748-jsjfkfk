import { Navigation } from "@/components/landing/Navigation";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, RefreshCw, Brain, Target, CheckCircle, AlertTriangle, Search, MessageSquare } from "lucide-react";
import { useEffect } from "react";

export default function LeadRecoveryLanding() {
  useEffect(() => {
    document.title = "AI Lead Recovery - Audnix AI | Recover Lost Deals";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-black overflow-x-hidden">
      <Navigation />
      <main className="pt-32">
        <section className="py-16 px-4 relative overflow-hidden">
          <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase tracking-[0.2em]">
                <RefreshCw className="w-3.5 h-3.5" /> Lead Recovery Engine
              </motion.div>
              <h1 className="text-4xl md:text-6xl font-black tracking-tighter leading-[0.9]">
                Recover Deals You <span className="text-primary">Thought Were Dead.</span>
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-xl">
                Audnix scans your inbox history, finds leads that went cold, analyzes why they ghosted, and generates personalized AI recovery drafts — all autonomously.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link href="/auth">
                  <Button size="lg" className="h-12 px-8 rounded-xl text-sm font-black uppercase tracking-widest bg-primary text-black">
                    Recover Lost Leads <ArrowRight className="ml-2 w-4 h-4" />
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
                { label: "Avg Recovery Rate", value: "34%", sub: "Of Ghosted Leads" },
                { label: "Inbox Scan Range", value: "90", sub: "Days of History" },
                { label: "Recovery Drafts", value: "AI", sub: "Personalized per Lead" },
                { label: "Objection Sync", value: "Auto", sub: "To Knowledge Base" },
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
            <h2 className="text-3xl font-black text-center mb-12">How It <span className="text-primary">Works</span></h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                { icon: Search, title: "Scan Inbox History", desc: "Audnix connects to your Gmail, Outlook, or custom SMTP and reads up to 90 days of sent/received emails. No data is stored — only metadata and lead profiles." },
                { icon: Brain, title: "Analyze & Classify", desc: "Each lead is classified by intent: Converted, Ghosted, Not Interested, or Reply Needed. The AI identifies the exact point where the conversation stalled." },
                { icon: MessageSquare, title: "Generate Recovery Draft", desc: "Using the conversation context, objection history, and your brand voice, the AI writes a personalized re-engagement email designed to restart the conversation." },
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
          <div className="max-w-4xl mx-auto">
            <h2 className="text-3xl font-black text-center mb-12">Key <span className="text-primary">Features</span></h2>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                "Scans 90 days of sent/received email history",
                "Auto-classifies leads by engagement level",
                "Detects hidden objections from conversation context",
                "Generates AI-powered recovery drafts per lead",
                "Syncs discovered objections to your knowledge base",
                "Pre-flight check before campaign launch",
                "Works across Gmail, Outlook, and custom SMTP",
                "No duplicate recovery on active campaign leads"
              ].map((f, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border/40">
                  <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <span className="text-sm text-foreground/80">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-border/10 bg-muted/20">
          <div className="max-w-3xl mx-auto text-center space-y-6">
            <h2 className="text-3xl font-black">Don't Leave Money on the Table.</h2>
            <p className="text-muted-foreground text-base max-w-lg mx-auto">34% of ghosted leads will re-engage with a well-timed, personalized follow-up. Start recovering yours today.</p>
            <Link href="/auth">
              <Button size="lg" className="h-12 px-8 rounded-xl text-sm font-black uppercase tracking-widest bg-primary text-black shadow-xl shadow-primary/30">
                Recover Leads Now <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Audnix AI Lead Recovery",
          "description": "AI-powered lead recovery engine that scans inbox history, analyzes ghosted leads, and generates personalized re-engagement drafts.",
          "brand": { "@type": "Brand", "name": "Audnix AI" },
          "offers": { "@type": "Offer", "price": "29", "priceCurrency": "USD", "availability": "https://schema.org/InStock" }
        })}
      </script>
      <CookieConsent />
    </div>
  );
}
