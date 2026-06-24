import { Navigation } from "@/components/landing/Navigation";
import { PricingSection } from "@/components/landing/PricingSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, Shield, CheckCircle } from "lucide-react";
import { useEffect } from "react";

export default function PricingPage() {
  useEffect(() => {
    document.title = "Pricing - Audnix AI | Autonomous Sales Agents";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-black overflow-x-hidden">
      <Navigation />

      <main className="pt-32">
        <PricingSection />

        {/* Feature Comparison */}
        <section className="py-16 px-4 relative overflow-hidden">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-12">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="text-3xl md:text-4xl font-black text-foreground mb-4"
              >
                Everything You Need to <span className="text-primary">Scale.</span>
              </motion.h2>
              <p className="text-muted-foreground text-base max-w-2xl mx-auto">
                All plans include our core AI engine. Upgrade as you grow.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {[
                { name: "Starter", price: "$29", period: "mo", features: ["1 Mailbox", "500 Leads/mo", "Basic AI Responses", "Email Support"] },
                { name: "Pro", price: "$79", period: "mo", features: ["5 Mailboxes", "5,000 Leads/mo", "Advanced AI + Objections", "Priority Support", "Custom Knowledge Base", "Analytics Dashboard"], popular: true },
                { name: "Enterprise", price: "$199", period: "mo", features: ["Unlimited Mailboxes", "50,000+ Leads/mo", "Full AI Suite", "White-Glove Onboarding", "API Access", "Dedicated Account Manager", "Custom Integrations"] },
              ].map((tier, i) => (
                <motion.div
                  key={tier.name}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className={`relative p-6 rounded-2xl border ${tier.popular ? "glass-premium border-primary/40 shadow-xl" : "bg-card border-border/40"} flex flex-col`}
                >
                  {tier.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-black text-[9px] font-black uppercase tracking-widest px-4 py-1 rounded-full">
                      Most Popular
                    </div>
                  )}
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-2">{tier.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-black text-foreground">{tier.price}</span>
                      <span className="text-xs text-muted-foreground">/{tier.period}</span>
                    </div>
                  </div>
                  <div className="space-y-3 flex-1 mb-6">
                    {tier.features.map((f, j) => (
                      <div key={j} className="flex items-center gap-3">
                        <CheckCircle className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-sm text-muted-foreground">{f}</span>
                      </div>
                    ))}
                  </div>
                  <Link href="/auth">
                    <Button className={`w-full h-10 rounded-xl text-xs font-bold uppercase tracking-widest ${tier.popular ? "bg-primary text-black" : "bg-muted text-foreground hover:bg-muted/80"}`}>
                      {tier.popular ? "Start Free Trial" : "Get Started"}
                    </Button>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <FAQSection />
      </main>

      {/* Final CTA */}
      <section className="py-16 px-4 border-t border-border/10">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h2 className="text-3xl font-black text-foreground">Ready to Close More Deals?</h2>
          <p className="text-muted-foreground text-base max-w-lg mx-auto">Join 14,000+ agencies and founders already using Audnix to automate their sales.</p>
          <Link href="/auth">
            <Button size="lg" className="h-12 px-8 rounded-xl text-sm font-black uppercase tracking-widest bg-primary text-black shadow-xl shadow-primary/30">
              Start Free Trial <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
          <p className="text-[10px] text-muted-foreground/40 font-medium">No credit card required. Cancel anytime.</p>
        </div>
      </section>

      {/* JSON-LD SEO Schema */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Audnix AI - Autonomous Sales Agents",
          "description": "Deploy AI sales agents that prospect, qualify, handle objections, and book meetings 24/7.",
          "brand": { "@type": "Brand", "name": "Audnix AI" },
          "offers": {
            "@type": "AggregateOffer",
            "priceCurrency": "USD",
            "lowPrice": "29",
            "highPrice": "199",
            "offerCount": "3",
            "availability": "https://schema.org/InStock"
          },
          "aggregateRating": {
            "@type": "AggregateRating",
            "ratingValue": "4.8",
            "ratingCount": "1200"
          }
        })}
      </script>

      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Audnix AI", "item": "https://audnixai.com" },
            { "@type": "ListItem", "position": 2, "name": "Pricing", "item": "https://audnixai.com/pricing" }
          ]
        })}
      </script>

      <CookieConsent />
    </div>
  );
}
