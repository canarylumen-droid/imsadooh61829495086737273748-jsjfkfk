import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Check, Zap, Activity, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { getSortedPricingTiers } from "@shared/plan-utils";
import { Tilt } from "@/components/ui/Tilt";

export function PricingSection() {
  const pricingTiers = getSortedPricingTiers().filter(tier => tier.id !== 'trial' && tier.id !== 'free');

  return (
    <section id="pricing" className="py-14 md:py-16 px-4 relative overflow-hidden bg-background">
      <div className="max-w-7xl mx-auto relative z-10">
        <div className="text-center mb-10">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center px-4 py-1.5 rounded-full bg-primary/5 border border-primary/10 text-primary text-[10px] font-bold uppercase tracking-[0.2em] mb-5 gap-2"
          >
            <ShieldCheck className="w-4 h-4" />
            Strategic Investment
          </motion.div>
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight text-foreground mb-4"
            >
              Start Closing Deals in <br />
              <span className="text-primary italic">Under 5 Minutes.</span>
            </motion.h2>
            <p className="text-muted-foreground font-medium text-base max-w-2xl mx-auto leading-relaxed">
              No setup fees. No contracts. Connect your inbox and deploy your first AI agent today.
            </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pricingTiers.map((tier, index) => {
            const isPopular = tier.id === 'pro';
            return (
              <Tilt key={tier.id} className="h-full">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 50 }}
                  whileInView={{ opacity: 1, scale: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1, duration: 0.8 }}
                  className={`p-5 rounded-xl border relative flex flex-col h-full transition-all duration-300 ${isPopular ? "glass-premium !bg-primary/5 border-primary/40 shadow-lg z-10" : "glass-premium border-border/40"
                    }`}
                >
                  {isPopular && (
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-8 py-2 rounded-full text-[10px] font-bold tracking-[0.2em] uppercase shadow-xl">
                      Recommended
                    </div>
                  )}

                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.3em]">{tier.name}</h3>
                      {isPopular && <Activity className="w-4 h-4 text-primary" />}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-foreground tracking-tight">
                        ${tier.price}
                      </span>
                      <span className="text-muted-foreground font-bold uppercase tracking-wider text-[10px]">/ {tier.period}</span>
                    </div>
                    <p className="text-muted-foreground text-xs mt-4 font-medium leading-relaxed">
                      {tier.description}
                    </p>
                  </div>

                  <div className="space-y-3 mb-5 flex-1">
                    {tier.features.slice(0, 8).map((feat, i) => (
                      <div key={i} className="flex items-start gap-4 group/item">
                        <div className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-primary/5 flex items-center justify-center border border-primary/10 group-hover/item:border-primary/50 transition-colors">
                          <Check className="w-3 h-3 text-primary" />
                        </div>
                        <span className="text-muted-foreground font-medium text-sm group-hover/item:text-foreground transition-colors">{feat}</span>
                      </div>
                    ))}
                  </div>

                  <Link href="/auth">
                    <Button
                      className={`h-10 w-full rounded-lg text-xs font-black uppercase tracking-widest transition-all duration-300 active:scale-95 group relative overflow-hidden ${isPopular
                        ? "bg-primary text-black shadow-2xl shadow-primary/30 hover:brightness-110"
                        : "bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 border-border/50"
                        }`}
                    >
                      <span className="relative z-10 flex items-center justify-center gap-3">
                        {isPopular ? "Start Free Trial" : "Get Started"}
                        <Zap className={`w-4 h-4 ${isPopular ? "fill-current" : ""}`} />
                      </span>
                    </Button>
                  </Link>

                  <p className="mt-4 text-center text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/30">
                    {isPopular ? "Includes Strategic ROI Mapping" : "Automated Lead Engagement"}
                  </p>
                </motion.div>
              </Tilt>
            );
          })}
        </div>
      </div>
    </section>
  );
}
