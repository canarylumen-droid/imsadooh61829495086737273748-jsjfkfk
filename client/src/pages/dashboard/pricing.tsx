import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { getActivePlanId } from "@shared/plan-utils";
import { Check, Loader2, Zap, ShieldCheck, Activity, TrendingUp, Sparkles, Mail } from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getSortedPricingTiers } from "@shared/plan-utils";
import { Badge } from "@/components/ui/badge";

interface UserProfile {
  id: string;
  email: string;
  plan?: string;
  subscriptionTier?: string;
}

export default function PricingPage() {
  const { toast } = useToast();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const pricingTiers = getSortedPricingTiers();

  const { data: user } = useQuery<UserProfile>({
    queryKey: ["/api/user/profile"],
    retry: false,
  });

  const currentPlan = getActivePlanId(user);
  const isPaidUser = currentPlan !== 'trial' && currentPlan !== '';

  const handleUpgrade = async (planId: string) => {
    if (currentPlan === planId) return;

    setLoadingPlan(planId);
    try {
      const response = await apiRequest('POST', '/api/billing/payment-link', { planKey: planId });
      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No payment link returned');
      }
    } catch (error) {
      console.error('Error getting payment link:', error);
      toast({
        title: "Error",
        description: "Failed to get payment link. Please try again.",
        variant: "destructive",
      });
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen pb-40 bg-background text-foreground selection:bg-primary selection:text-black">
      <div className="max-w-7xl mx-auto px-6 relative">
        {/* Background Ambience */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[600px] bg-primary/5 blur-[150px] rounded-full pointer-events-none -z-10" />

        {/* Header Section */}
        <div className="text-center pt-24 mb-20 relative">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-muted border border-border text-primary text-[10px] font-semibold uppercase tracking-wider mb-8 shadow-[0_0_20px_rgba(var(--primary),0.05)]"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Select Your Scaling Engine
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-6xl font-bold tracking-tight mb-8 leading-none uppercase"
          >
            Scale your <br />
            <span className="text-primary drop-shadow-[0_0_40px_rgba(var(--primary),0.2)]">Intelligence.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-muted-foreground font-medium text-lg max-w-2xl mx-auto leading-tight"
          >
            Deploy autonomous agents that handle outreach, objection mastery, and closed revenue.
            <span className="text-foreground ml-2 underline underline-offset-8 decoration-primary/40 font-semibold">Scale instantly.</span>
          </motion.p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8 items-start max-w-6xl mx-auto">
          {pricingTiers.filter(tier => isPaidUser ? tier.id !== 'trial' : true).map((tier, index) => {
            const isPopular = tier.id === 'pro';
            const isCurrentPlan = currentPlan === tier.id;
            const isPaidPlan = tier.id !== 'trial';

            return (
              <motion.div
                key={tier.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`
                  relative w-full p-5 sm:p-8 rounded-2xl border flex flex-col h-full transition-all duration-500 group
                  ${isCurrentPlan
                    ? "bg-primary/[0.05] border-primary/50 shadow-[0_0_50px_rgba(var(--primary),0.15)] z-10 scale-[1.02]"
                    : isPopular
                      ? "bg-muted/30 border-primary/30 shadow-2xl hover:border-primary/60 hover:bg-muted/50 z-10 lg:-mt-6 lg:mb-6"
                      : "bg-muted/20 border-border hover:border-border/60 hover:bg-muted/40"
                  }
                `}
              >
                {isPopular && (
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-6 py-2 bg-primary rounded-full text-black text-[10px] font-bold uppercase tracking-wider shadow-[0_10px_30px_rgba(var(--primary),0.4)]">
                    Most Popular
                  </div>
                )}

                <div className="mb-10">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">{tier.name}</h3>
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-colors duration-500
                        ${isPopular ? 'bg-primary/10 border-primary/20 text-primary' : 'bg-muted border-border text-muted-foreground'}
                    `}>
                      {isPopular ? <Zap className="w-5 h-5 fill-primary" /> : <Sparkles className="w-5 h-5" />}
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-foreground tracking-tight">
                      {tier.price !== null ? `$${tier.price}` : "Custom"}
                    </span>
                    <span className="text-muted-foreground font-semibold text-xs uppercase tracking-wider">
                      {tier.price !== null ? `/ ${tier.period}` : "Pricing"}
                    </span>
                  </div>
                </div>

                <div className="space-y-5 mb-10 flex-1">
                  {tier.features.map((feature, i) => (
                    <div key={i} className="flex items-start gap-4">
                      <div className="mt-1 flex-shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center border border-border group-hover:border-primary/30 transition-colors">
                        <Check className="w-3 h-3 text-primary" />
                      </div>
                      <span className="text-muted-foreground font-semibold text-[13px] leading-snug tracking-tight">
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto pt-8 border-t border-border space-y-6">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="w-3.5 h-3.5 text-primary" />
                        <span>{tier.leadsLimit.toLocaleString()} Leads / Mo</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-primary" />
                        <span>{tier.mailboxLimit} Mailbox{tier.mailboxLimit > 1 ? 'es' : ''}</span>
                      </div>
                    </div>
                    {tier.voiceMinutes > 0 && (
                      <div className="flex items-center gap-2 self-start">
                        <Activity className="w-3.5 h-3.5 text-primary" />
                        <span>{tier.voiceMinutes} AI Mins</span>
                      </div>
                    )}
                  </div>

                  <Button
                    className={`
                        h-11 w-full rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all duration-500
                        ${isCurrentPlan
                        ? "bg-muted text-muted-foreground cursor-default border-border"
                        : isPopular
                          ? "bg-primary text-black hover:bg-primary/90 shadow-[0_20px_40px_rgba(var(--primary),0.2)]"
                          : "bg-foreground text-background hover:bg-foreground/90"
                      }
                    `}
                    onClick={() => isPaidPlan ? handleUpgrade(tier.id) : null}
                    disabled={isCurrentPlan || (loadingPlan === tier.id)}
                  >
                    {loadingPlan === tier.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : null}
                    {isCurrentPlan ? "Current Plan" : "Start Scaling"}
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Footer info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-32 text-center"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-12">
            Secure Infrastructure powered by Stripe PCI-DSS Level 1
          </p>
          <div className="flex justify-center flex-wrap gap-12 text-muted-foreground">
            <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Enterprise Grade Security
            </div>
            <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider">
              <Activity className="w-5 h-5 text-primary" />
              99.99% Uptime SLA
            </div>
            <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider">
              <TrendingUp className="w-5 h-5 text-primary" />
              Autonomous Recovery
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
