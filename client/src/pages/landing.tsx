import { useEffect } from "react";
import { Navigation } from "@/components/new-landing/navigation";
import { HeroSection } from "@/components/new-landing/hero-section";
import { FeaturesSection } from "@/components/new-landing/features-section";
import { HowItWorksSection } from "@/components/new-landing/how-it-works-section";
import { InfrastructureSection } from "@/components/new-landing/infrastructure-section";
import { MetricsSection } from "@/components/new-landing/metrics-section";
import { IntegrationsSection } from "@/components/new-landing/integrations-section";
import { SecuritySection } from "@/components/new-landing/security-section";
import { DevelopersSection } from "@/components/new-landing/developers-section";
import { TestimonialsSection } from "@/components/new-landing/testimonials-section";
import { PricingSection } from "@/components/new-landing/pricing-section";
import { FAQSection } from "@/components/new-landing/faq-audnix";
import { CtaSection } from "@/components/new-landing/cta-section";
import { ROICalculator } from "@/components/new-landing/roi-calculator";
import { FooterSection } from "@/components/new-landing/footer-section";
import { useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useUser();

  useEffect(() => {
    document.title = "AUDNIX — Cold Email Platform";
    let meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Scale cold email outreach with AI. Personalized campaigns, automatic follow-ups, and qualified leads. The platform for founders and sales teams.");
  }, []);

  useEffect(() => {
    if (!userLoading && user) {
      const lastActive = localStorage.getItem('auth_last_active');
      if (lastActive && Date.now() - Number(lastActive) < 3600000) {
        setLocation("/dashboard");
      }
    }
  }, [user, userLoading, setLocation]);

  if (!userLoading && user) {
    const lastActive = localStorage.getItem('auth_last_active');
    if (lastActive && Date.now() - Number(lastActive) < 3600000) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-muted-foreground text-sm font-medium">Entering Dashboard...</p>
          </div>
        </div>
      );
    }
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050505]">
      <Navigation />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <InfrastructureSection />
      <MetricsSection />
      <IntegrationsSection />
      <SecuritySection />
      <DevelopersSection />
      <TestimonialsSection />
      <ROICalculator />
      <FAQSection />
      <PricingSection />
      <CtaSection />
      <FooterSection />
    </main>
  );
}
