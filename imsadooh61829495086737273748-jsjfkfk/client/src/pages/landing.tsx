import { useEffect, useMemo } from "react";
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
    document.title = "AUDNIX — AI Sales Agent | Cold Email & Lead Generation Platform";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "AUDNIX is the autonomous AI sales platform for cold email outreach, lead generation, and objection handling. AI SDR that prospects, qualifies, and books meetings 24/7.");
  }, []);

  const shouldRedirect = useMemo(() => {
    if (userLoading || !user) return false;
    const lastActive = localStorage.getItem('auth_last_active');
    return !!(lastActive && Date.now() - Number(lastActive) < 3600000);
  }, [user, userLoading]);

  useEffect(() => {
    if (shouldRedirect) {
      setLocation("/dashboard");
    }
  }, [shouldRedirect, setLocation]);

  if (userLoading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-[#2196f3] border-t-transparent rounded-full animate-spin" />
          <p className="text-[#7a7a7a] text-sm font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (shouldRedirect) {
    return null;
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
      <FAQSection />
      <PricingSection />
      <ROICalculator />
      <CtaSection />
      <FooterSection />
    </main>
  );
}
