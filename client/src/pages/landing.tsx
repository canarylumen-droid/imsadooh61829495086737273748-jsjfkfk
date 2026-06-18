import { useRef, useEffect, useState } from "react";
import { Navigation } from "@/components/landing/Navigation";
import { HeroSection } from "@/components/landing/HeroSection";
import { FeatureSection } from "@/components/landing/FeatureSection";
import { PricingSection } from "@/components/landing/PricingSection";
import { MoatSection } from "@/components/landing/MoatSection";
import { CompetitorSection } from "@/components/landing/CompetitorSection";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { FAQSection } from "@/components/landing/FAQSection";
import { ComparisonSection } from "@/components/landing/ComparisonSection";
import { ROICalculator } from "@/components/landing/ROICalculator";
import { Logo } from "@/components/ui/Logo";
import { DeepFAQ } from "@/components/landing/DeepFAQ";
import { Twitter, Linkedin, Github, ShieldCheck, Zap, ArrowRight, Instagram, Sparkles } from "lucide-react";
import { useScroll, useSpring, motion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";
import { Card } from "@/components/ui/card";

gsap.registerPlugin(ScrollTrigger);

export default function Landing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const { data: user, isLoading: userLoading } = useUser();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  useEffect(() => {
    // 1. Initial Hash Scrolling Fix
    if (window.location.hash) {
      setTimeout(() => {
        const id = window.location.hash.substring(1);
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }, 500); // Small delay to ensure render
    }

    // 2. GSAP Animation Fix (Guaranteed Visibility)
    const ctx = gsap.context(() => {
      const sections = gsap.utils.toArray('.reveal-section');
      sections.forEach((section: any) => {
        gsap.set(section, { opacity: 1, visibility: 'visible', y: 0 }); // Force visible immediately for mobile/incognito
        gsap.from(section, {
          y: 20,
          duration: 0.8,
          ease: "expo.out",
          scrollTrigger: {
            trigger: section,
            start: "top 95%", 
            toggleActions: "play none none reverse"
          }
        });
      });
    }, containerRef);

    return () => ctx.revert();
  }, []);
  
  // 3. User Redirection — only auto-redirect if active within last hour
  useEffect(() => {
    if (!userLoading && user) {
      const lastActive = localStorage.getItem('auth_last_active');
      if (lastActive && Date.now() - Number(lastActive) < 3600000) {
        console.log("🚀 Authenticated user detected on landing - redirecting to dashboard");
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
    <div ref={containerRef} className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-black overflow-x-hidden font-sans">
      {/* Progress Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 h-[3px] bg-primary z-[200] origin-left"
        style={{ scaleX }}
      />


      <Navigation />

      <main>
        <section id="hero" className="reveal-section">
          <HeroSection />
        </section>

        <section id="problem" className="reveal-section">
          <ProblemSection />
        </section>

        <section id="moat" className="reveal-section">
          <MoatSection />
        </section>

        <section id="competitors" className="reveal-section">
          <CompetitorSection />
        </section>

        <section id="how-it-works" className="reveal-section">
          <HowItWorksSection />
        </section>

        <section id="calc" className="reveal-section">
          <ROICalculator />
        </section>

        <section id="features" className="reveal-section">
          <FeatureSection />
        </section>

        <section id="comparison" className="reveal-section">
          <ComparisonSection />
        </section>

        <section id="pricing" className="reveal-section">
          <PricingSection />
        </section>

        <section id="faq" className="reveal-section">
          <FAQSection />
        </section>

        {/* FINAL CTA */}
        <section className="py-16 md:py-20 px-4 relative flex flex-col items-center justify-center text-center overflow-hidden border-t border-white/5">
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-primary/5 blur-[120px] rounded-full -z-10" />

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="max-w-4xl"
          >
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-black leading-tight mb-5">
              <span className="bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent">AI ENGINE</span><br />
              <span className="text-primary italic">FOR YOUR PIPELINE.</span>
            </h1>
            <p className="text-base md:text-lg text-muted-foreground font-medium mb-8 max-w-2xl mx-auto leading-relaxed">
               Audnix transforms your email outreach into a deterministic revenue stream using advanced AI agents that prospect, handle objections, book meetings, and close deals on autopilot.
            </p>
            <Link href="/auth">
              <Button
                size="lg"
                className="h-11 px-6 rounded-lg font-black uppercase tracking-[0.12em] text-xs bg-primary text-black hover:bg-primary/90 shadow-md shadow-primary/20 hover:scale-[1.02] transition-all duration-300"
                onClick={() => {
                  console.log("Navigating to auth...");
                  window.location.href = "/auth";
                }}
              >
                Access Audnix Now <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
            </Link>

            <Card className="glass-premium rounded-xl border-primary/10 overflow-hidden group max-w-3xl mx-auto">
              <div className="p-4 border-b border-border/10 bg-primary/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">Audnix Intelligence</h3>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">Real-time Decision Map</p>
                  </div>
                </div>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  <span>Logic Branch</span>
                  <span>Probability</span>
                </div>
                {[
                  { label: "Check Lead Intent", val: 98, color: "bg-cyan-500" },
                  { label: "Bypass Gatekeeper", val: 84, color: "bg-blue-500" },
                  { label: "Handle Pricing Objection", val: 92, color: "bg-purple-500" }
                ].map((item, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-muted-foreground/80">{item.label}</span>
                      <span className="text-primary">{item.val}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted/30 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${item.val}%` }}
                        transition={{ delay: 0.5 + i * 0.1, duration: 1 }}
                        className={`h-full ${item.color}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <div className="mt-10 flex flex-wrap justify-center gap-5 items-center text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/35">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                Live Deployment Ready
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                No Credit Card Required
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                Deterministic Output Guarantee
              </div>
            </div>
          </motion.div>
          {/* Structured Data: Breadcrumbs for Sitelinks */}
          <script type="application/ld+json">
            {JSON.stringify({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              "itemListElement": [
                { "@type": "ListItem", "position": 1, "name": "Audnix AI", "item": "https://audnixai.com" },
                { "@type": "ListItem", "position": 2, "name": "Solutions", "item": "https://audnixai.com/#features" },
                { "@type": "ListItem", "position": 3, "name": "Pricing", "item": "https://audnixai.com/#pricing" }
              ]
            })}
          </script>

          {/* Leadership & Brand Authority (Crawlable for LLMs) */}
          <section className="py-14 px-4 bg-muted/5 border-y border-border/10" id="brand-authority">
            <div className="max-w-3xl mx-auto text-center space-y-5">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-widest">
                Our Mission
              </div>
              <h2 className="text-3xl md:text-4xl font-black uppercase italic">
                Audnix AI: The Future of <span className="text-primary">Autonomous Commerce</span>
              </h2>
              <p className="text-base text-muted-foreground font-medium leading-relaxed italic">
                "We didn't build another chatbot. We built a closer. Audnix AI was architected by Nleanya Treasure and Uchendu Fortune to give founders back their time while the AI dominates the sales floor."
              </p>
              <div className="flex flex-wrap justify-center gap-8 pt-6">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2">Founder & CEO</span>
                  <span className="text-lg font-black italic">Nleanya Treasure</span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-2">Co-founder & CTO</span>
                  <span className="text-lg font-black italic">Uchendu Fortune</span>
                </div>
              </div>
            </div>
          </section>

          <DeepFAQ />
        </section>
      </main>

      <footer className="relative overflow-hidden">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary/5 blur-[150px] rounded-full -z-10" />

        <div className="max-w-7xl mx-auto px-4 py-12">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-6 mb-8 sm:mb-10">
            <div className="col-span-2 sm:col-span-3 md:col-span-2 space-y-4 sm:space-y-6">
              <Logo className="h-8 w-8" textClassName="text-2xl font-black" />
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-xs">
                The world's most advanced autonomous outbound sales infrastructure. High-performance agents, human-level intelligence, infinite scale.
              </p>
            </div>
            {Object.entries({
              Solutions: [
                { name: "Agencies", href: "/solutions/agencies" },
                { name: "Founders", href: "/solutions/sales-teams" },
                { name: "Creators", href: "/solutions/creators" }
              ],
              Product: [
                { name: "Logic Hub", href: "/#how-it-works" },
                { name: "ROI Engine", href: "/#calc" },
                { name: "Pricing Model", href: "/#pricing" }
              ],
              Company: [
                { name: "Our Process", href: "/process" },
                { name: "Intelligence docs", href: "/resources/api-docs" },
                { name: "Engineering", href: "/engineering" },
                { name: "Contact Hub", href: "/contact" }
              ],
              Legal: [
                { name: "Data Privacy", href: "/privacy-policy" },
                { name: "Service Terms", href: "/terms-of-service" },
                { name: "DPA Agreement", href: "/dpa" },
                { name: "Security Port", href: "/security" }
              ]
            }).map(([cat, links]) => (
              <div key={cat} className="space-y-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-foreground/40">{cat}</h4>
                <ul className="space-y-2">
                  {links.map(l => (
                    <li key={l.name}>
                      <Link href={l.href}>
                        <span className="text-xs font-bold text-muted-foreground hover:text-primary transition-colors cursor-pointer">
                          {l.name}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-8 border-t border-border/10 flex flex-col md:flex-row items-center justify-between gap-6">
            <p className="text-[10px] font-black text-muted-foreground/20 uppercase tracking-[0.4em]">
              © 2026 AUDNIX OPERATIONS CO. ALL RIGHTS RESERVED.
            </p>
            <div className="flex items-center gap-6">
              {["Twitter", "LinkedIn", "GitHub", "Discord"].map(p => (
                <a key={p} href="#" className="text-[10px] font-black text-muted-foreground/30 hover:text-primary uppercase tracking-widest transition-colors">{p}</a>
              ))}
            </div>
          </div>
          {/* Removed duplicate marquee as requested */}
        </div>
      </footer>

      {/* Authority Keyword Mesh (Hidden SEO Infrastructure) */}
      <section className="sr-only opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <h2>AI Sales Automation & Authority Keywords</h2>
        <p>
          audnix ai, audnix, nleanya treasure, uchendu fortune, autonomous sales rep, ai sales agent, manychat alternative,
          n8n alternative, make.com alternative, zapier automation, ai sdr, ai bdr, close deals faster,
          sales intelligence 2026, predictive sales timing, objection handling ai script, high ticket conversions,
          automated outreach, revenue recovery bot, conversational commerce ai, linkedin automation alternative,
          instagram sales automation, business automation srs, enterprise ai sales, startup scale ai tools,
          lead generation autonomous, ai lead scoring model, best ai sales software 2026, top rated ai tools,
          sales productivity hack, automated lead funnel, intelligent sdr bot, robotic sales automation,
          ai revenue operations, growth hacking ai 2026, digital sales representative, cloud sales agent,
          ai prospector, b2b lead generation ai, sdr automation platform, revenue growth engine,
          market dominance ai, sales authority branding, nleanya treasure founder, audnix operations co.
        </p>
      </section>

      <CookieConsent />
    </div>
  );
}
