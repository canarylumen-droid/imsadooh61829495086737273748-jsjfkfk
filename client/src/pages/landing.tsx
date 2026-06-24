import { useRef, useEffect } from "react";
import { Navigation } from "@/components/landing/Navigation";
import { Logo } from "@/components/ui/Logo";
import { Check, ChevronRight } from "lucide-react";
import { useScroll, useSpring, motion } from "framer-motion";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";

function useSEO(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', description);
  }, [title, description]);
}

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

  useSEO(
    "Audnix AI - Autonomous Sales Agents | AI SDR & Cold Email Platform",
    "Audnix is the AI sales platform that prospects, handles objections, follows up autonomously, and books meetings. Replace your SDR team with AI that works 24/7."
  );

  useEffect(() => {
    if (window.location.hash) {
      setTimeout(() => {
        const id = window.location.hash.substring(1);
        const element = document.getElementById(id);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }, 500);
    }
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
            <div className="w-12 h-12 border-2 border-[#2196f3] border-t-transparent rounded-full animate-spin" />
            <p className="text-[#5a5a5a] text-sm font-medium">Entering Dashboard...</p>
          </div>
        </div>
      );
    }
  }

  const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
  const staggerContainer = { animate: { transition: { staggerChildren: 0.08 } } };
  const scaleIn = { initial: { opacity: 0, scale: 0.95 }, whileInView: { opacity: 1, scale: 1 }, viewport: { once: true }, transition: { duration: 0.6 } };

  const METRICS = [
    { value: "42%", label: "Avg Open Rate", sub: "Industry avg: 25%" },
    { value: "18%", label: "Response Rate", sub: "Highly qualified" },
    { value: "24/7", label: "AI Prospecting", sub: "Never stops closing" },
    { value: "10x", label: "Faster Outreach", sub: "Than manual SDRs" }
  ];

  const FEATURES = [
    { title: "AI Lead Prospecting", desc: "Identify and prioritize high-intent leads with predictive scoring models that learn from your best conversions." },
    { title: "Smart Email Outreach", desc: "Personalized cold email campaigns at scale. AI writes, sends, and optimizes every message for maximum reply rates." },
    { title: "110+ Objection Handling", desc: "AI anticipates and overcomes every buyer objection with proven battle cards tailored to your offer." },
    { title: "Autonomous Follow-ups", desc: "Perfect-timed follow-ups triggered by prospect behavior. Never lose a warm lead to slow response again." },
    { title: "AI Voice Minutes", desc: "Voice intelligence that clones your tone, handles discovery calls, and books qualified meetings on your calendar." },
    { title: "Deep Analytics", desc: "Real-time dashboards tracking opens, replies, meetings booked, and revenue influenced across every campaign." }
  ];

  return (
    <div ref={containerRef} className="min-h-screen bg-background text-[#f2ede6] overflow-x-hidden">
      <motion.div className="fixed top-0 left-0 right-0 h-[2px] bg-[#2196f3] z-[200] origin-left" style={{ scaleX }} />

      <Navigation />

      <main>
        {/* HERO */}
        <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden border-b border-[#1e1e1e]">
          <motion.div initial="initial" animate="animate" variants={staggerContainer} className="relative z-10 max-w-5xl mx-auto text-center">
            <motion.div variants={fadeInUp}>
              <span className="sys-tag">PREDICTIVE INTELLIGENCE LAYER V4.0</span>
            </motion.div>
            <motion.h1 variants={fadeInUp} className="font-display text-[clamp(3rem,12vw,7rem)] leading-[0.88] tracking-tight mt-6 mb-6 font-black">
              Scale Revenue,<br /><span className="text-[#2196f3]">Not Headcount</span>
            </motion.h1>
            <motion.p variants={fadeInUp} className="text-base text-[#5a5a5a] leading-relaxed max-w-2xl mx-auto mb-8">
              Audnix combines AI prospecting, objection handling, voice intelligence, and autonomous follow-ups into one deterministic revenue engine. Stop losing deals to slow responses.
            </motion.p>
            <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/auth">
                <Button className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#60a5fa] transition-colors font-semibold h-auto rounded-none">
                  GET STARTED FREE
                  <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
              <a href="#features" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
                SEE HOW IT WORKS
              </a>
            </motion.div>
          </motion.div>
        </section>

        {/* METRICS */}
        <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
              {METRICS.map((m, i) => (
                <motion.div key={i} variants={fadeInUp} className="text-center p-4 md:p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                  <div className="font-display text-3xl md:text-5xl text-[#2196f3] mb-1 md:mb-2">{m.value}</div>
                  <div className="font-display text-sm md:text-lg mb-1">{m.label}</div>
                  <div className="font-mono text-[9px] md:text-[10px] tracking-widest text-[#5a5a5a]">{m.sub}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* FEATURES */}
        <section id="features" className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
            <motion.div variants={fadeInUp}>
              <span className="sys-tag mb-4 block">CORE PLATFORM</span>
              <h2 className="font-display text-5xl md:text-6xl leading-[0.88] tracking-tight mb-6">
                Everything You Need<br /><span className="text-[#2196f3]">to Close Deals</span>
              </h2>
            </motion.div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
              {FEATURES.map((f, i) => (
                <motion.div key={i} variants={fadeInUp} className="p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                  <div className="w-8 h-8 bg-[#2196f3]/10 border border-[#2196f3]/20 flex items-center justify-center mb-4">
                    <div className="w-3 h-3 bg-[#2196f3]" />
                  </div>
                  <h3 className="font-display text-xl mb-2">{f.title}</h3>
                  <p className="text-[#5a5a5a] text-sm leading-relaxed">{f.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* HOW IT WORKS */}
        <section id="how-it-works" className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-12">
            <motion.div variants={fadeInUp}>
              <span className="sys-tag mb-4 block">PROCESS</span>
              <h2 className="font-display text-5xl md:text-6xl leading-[0.88] tracking-tight">
                How It <span className="text-[#2196f3]">Works</span>
              </h2>
            </motion.div>
            {[
              { num: "01", title: "Connect Your CRM", desc: "Plug into Salesforce, HubSpot, Pipedrive. Your existing workflows stay intact." },
              { num: "02", title: "Upload Playbooks", desc: "AI learns your exact closing style in 48 hours. Battle cards and scripts included." },
              { num: "03", title: "AI Handles Outreach", desc: "Autonomous prospecting, personalized emails, objection handling, and follow-ups." },
              { num: "04", title: "You Close Deals", desc: "Qualified meetings land on your calendar. Only high-intent leads reach your inbox." }
            ].map((step, i) => (
              <motion.div key={i} variants={fadeInUp} className="flex gap-6 md:gap-8 items-start">
                <div className="flex-shrink-0 w-12 md:w-16">
                  <div className="font-display text-2xl md:text-3xl text-[#2196f3]">{step.num}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-lg md:text-2xl mb-2">{step.title}</h3>
                  <p className="text-[#5a5a5a] text-sm md:text-base leading-relaxed">{step.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* COMPARISON */}
        <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
            <motion.div variants={fadeInUp}>
              <span className="sys-tag mb-4 block">WHY AUDNIX</span>
              <h2 className="font-display text-5xl md:text-6xl leading-[0.88] tracking-tight mb-8">
                Audnix vs <span className="text-[#2196f3]">The Rest</span>
              </h2>
            </motion.div>
            <motion.div variants={fadeInUp} className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#1e1e1e]">
                    <th className="text-left py-4 px-6 font-mono font-semibold text-[#f2ede6] text-xs lg:text-sm">FEATURE</th>
                    <th className="text-center py-4 px-6 font-mono font-semibold text-[#2196f3] text-xs lg:text-sm">AUDNIX</th>
                    <th className="text-center py-4 px-6 font-mono font-semibold text-[#5a5a5a] text-xs lg:text-sm">HIRED SDR</th>
                    <th className="text-center py-4 px-6 font-mono font-semibold text-[#5a5a5a] text-xs lg:text-sm">OTHER AI</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: "24/7 Availability", audnix: "\u2713", sdr: "\u2717", other: "\u2713" },
                    { feature: "110+ Objection Handling", audnix: "\u2713", sdr: "\u2713", other: "\u2717" },
                    { feature: "Voice Intelligence", audnix: "\u2713", sdr: "\u2717", other: "\u2717" },
                    { feature: "Predictive Timing", audnix: "\u2713", sdr: "\u2717", other: "\u2717" },
                    { feature: "CRM Integration", audnix: "\u2713", sdr: "\u2713", other: "\u25b3" },
                    { feature: "Setup Time", audnix: "1 min", sdr: "30+ days", other: "7-14 days" },
                    { feature: "Cost per Lead", audnix: "$0.05", sdr: "$5-10", other: "$0.50" },
                    { feature: "Scalability", audnix: "Unlimited", sdr: "Limited", other: "Limited" }
                  ].map((row, i) => (
                    <tr key={i} className="border-b border-[#1e1e1e] hover:bg-[#0a0a0a] transition-colors">
                      <td className="py-4 px-6 font-mono text-[#f2ede6] text-xs lg:text-sm">{row.feature}</td>
                      <td className="py-4 px-6 text-center text-[#2196f3] font-semibold text-xs lg:text-sm">{row.audnix}</td>
                      <td className="py-4 px-6 text-center text-[#5a5a5a] text-xs lg:text-sm">{row.sdr}</td>
                      <td className="py-4 px-6 text-center text-[#5a5a5a] text-xs lg:text-sm">{row.other}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </motion.div>
          </motion.div>
        </section>

        {/* PRICING */}
        <section id="pricing" className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
            <motion.div variants={fadeInUp}>
              <span className="sys-tag mb-4 block">TRANSPARENT PRICING</span>
              <h2 className="font-display text-5xl md:text-6xl leading-[0.88] tracking-tight mb-12">
                Scale Revenue,<br /><span className="text-[#2196f3]">Not Costs</span>
              </h2>
            </motion.div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { name: "ACCELERATOR TRIAL", tagline: "3-day free trial", price: "$0", features: ["10,000 lead sync", "2 Mailboxes", "100 AI Voice Minutes", "Basic Cadence"], highlight: false },
                { name: "GROWTH", tagline: "Scale your pipeline", price: "$49", features: ["2,500 leads/mo", "5 Mailboxes", "250 AI Voice Minutes", "Smart CRM Integration", "Performance Analytics"], highlight: false },
                { name: "PERFORMANCE", tagline: "Enterprise-grade closing", price: "$99", features: ["7,000 leads/mo", "15 Mailboxes", "1,000 AI Voice Minutes", "110+ Objection Mastery", "Priority Support"], highlight: true, popular: true }
              ].map((plan, i) => (
                <motion.div key={i} variants={fadeInUp} className={`border border-[#1e1e1e] p-8 ${plan.highlight ? 'bg-[#0e0e0e]' : ''}`}>
                  {plan.popular && <div className="h-px bg-[#2196f3] mb-6" />}
                  <div className="flex items-start justify-between mb-4">
                    <span className="font-mono text-[9px] text-[#5a5a5a]">{String(i + 1).padStart(2, '0')}</span>
                    {plan.popular && <span className="font-mono text-[9px] tracking-widest border border-[#2196f3]/40 text-[#2196f3] px-2 py-1">POPULAR</span>}
                  </div>
                  <h3 className="font-display text-2xl text-[#f2ede6] mb-1">{plan.name}</h3>
                  <p className="font-mono text-[10px] text-[#5a5a5a] tracking-wider mb-6">{plan.tagline}</p>
                  <div className="flex items-baseline gap-2 mb-6">
                    <span className="font-display text-5xl text-[#f2ede6]">{plan.price}</span>
                    <span className="font-mono text-[10px] text-[#5a5a5a]">/MONTH</span>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-start gap-3">
                        <Check className="w-4 h-4 text-[#2196f3] flex-shrink-0 mt-0.5" />
                        <span className="font-mono text-[11px] text-[#5a5a5a]">{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Link href="/auth">
                    <Button className={`w-full flex items-center justify-between font-mono text-[11px] tracking-widest px-5 py-4 transition-colors group h-auto rounded-none ${plan.highlight ? 'bg-[#2196f3] text-[#050505] hover:bg-[#60a5fa]' : 'border border-[#2e2e2e] text-[#5a5a5a] hover:border-[#2196f3]/40 hover:text-[#2196f3] bg-transparent'}`}>
                      {plan.name === "ACCELERATOR TRIAL" ? "START FREE TRIAL" : "GET STARTED"}
                      <span className="transition-transform group-hover:translate-x-1">\u2192</span>
                    </Button>
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-20 px-6 lg:px-12 max-w-4xl mx-auto border-b border-[#1e1e1e]">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
            <motion.div variants={fadeInUp}>
              <span className="sys-tag mb-4 block">FREQUENTLY ASKED</span>
              <h2 className="font-display text-5xl md:text-6xl leading-[0.88] tracking-tight mb-12">
                Common <span className="text-[#2196f3]">Questions</span>
              </h2>
            </motion.div>
            <div className="divide-y divide-[#1e1e1e]">
              {[
                { q: "How does Audnix compare to hiring an SDR?", a: "Audnix costs 95% less than a full-time SDR, works 24/7, never takes vacation, and scales instantly. Setup takes minutes vs months of hiring and training." },
                { q: "Will emails end up in spam?", a: "No. We enforce SPF/DKIM/DMARC, use natural sending patterns, and include warmup sequences. 98%+ inbox placement rate guaranteed." },
                { q: "How long until I see results?", a: "First responses within 2-3 days. Full campaign momentum in 1-2 weeks. Most users see positive ROI by week 2." },
                { q: "Can I white-label Audnix for my agency?", a: "Yes. 100% white-label. Your brand, your domain, your logo. Clients never know it's AI. Revenue share model available." },
                { q: "What CRM integrations do you support?", a: "Salesforce, HubSpot, Pipedrive, and 50+ others. Integration takes 15 minutes with our pre-built connectors." }
              ].map((faq, i) => (
                <motion.div key={i} variants={fadeInUp} className="py-5">
                  <h3 className="font-display text-lg text-[#f2ede6] mb-2">{faq.q}</h3>
                  <p className="font-mono text-xs text-[#5a5a5a] leading-relaxed">{faq.a}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </section>

        {/* FINAL CTA */}
        <section className="py-20 px-6 lg:px-12 text-center border-b border-[#1e1e1e]">
          <motion.div {...scaleIn} className="max-w-2xl mx-auto">
            <span className="sys-tag mb-4 block justify-center">GET STARTED</span>
            <h2 className="font-display text-5xl md:text-6xl mb-4">Ready to Scale Revenue?</h2>
            <p className="text-[#5a5a5a] mb-8">All plans include a 3-day free trial. No credit card required.</p>
            <Link href="/auth">
              <Button className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#60a5fa] transition-colors font-semibold h-auto rounded-none">
                START FREE TRIAL
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </motion.div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="relative overflow-hidden border-t border-[#1e1e1e]">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-8 mb-8">
            <div className="col-span-2 space-y-4">
              <Logo className="h-8 w-8" textClassName="text-2xl font-black text-[#f2ede6]" />
              <p className="text-[11px] font-mono text-[#5a5a5a] leading-relaxed max-w-xs">
                The world's most advanced autonomous outbound sales infrastructure.
              </p>
            </div>
            {Object.entries({
              Solutions: [
                { name: "Agencies", href: "/solutions/agencies" },
                { name: "Founders", href: "/solutions/sales-teams" },
                { name: "Creators", href: "/solutions/creators" }
              ],
              Product: [
                { name: "Pricing", href: "/pricing" },
                { name: "Lead Recovery", href: "/lead-recovery" },
                { name: "Objection Handling", href: "/objection-handling" }
              ],
              Company: [
                { name: "Privacy", href: "/privacy-policy" },
                { name: "Terms", href: "/terms-of-service" },
                { name: "Data Deletion", href: "/data-deletion" }
              ]
            }).map(([cat, links]) => (
              <div key={cat} className="space-y-4">
                <h4 className="font-mono text-[9px] uppercase tracking-[0.3em] text-[#5a5a5a]">{cat}</h4>
                <ul className="space-y-2">
                  {links.map(l => (
                    <li key={l.name}>
                      <Link href={l.href}>
                        <span className="font-mono text-[11px] text-[#5a5a5a] hover:text-[#2196f3] transition-colors cursor-pointer">{l.name}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-8 border-t border-[#1e1e1e] flex flex-col md:flex-row items-center justify-between gap-6">
            <p className="font-mono text-[9px] text-[#3a3a3a] uppercase tracking-[0.3em]">
              \u00a9 2026 AUDNIX OPERATIONS CO.
            </p>
            <div className="flex items-center gap-6">
              {["X", "LI", "GH"].map(s => (
                <a key={s} href="#" className="font-mono text-[9px] text-[#3a3a3a] hover:text-[#2196f3] uppercase tracking-widest transition-colors">{s}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* BreadcrumbList JSON-LD (page-specific) */}
      <script type="application/ld+json">
        {JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://audnixai.com" },
            { "@type": "ListItem", "position": 2, "name": "Solutions", "item": "https://audnixai.com/#features" },
            { "@type": "ListItem", "position": 3, "name": "Pricing", "item": "https://audnixai.com/#pricing" }
          ]
        })}
      </script>

      {/* SEO Keywords (merged with old authority keywords) */}
      <section className="sr-only opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <h2>AI Sales Automation & Authority Keywords</h2>
        <p>
          audnix ai, audnix, nleanya treasure, uchendu fortune, autonomous sales rep, ai sales agent,
          alternative to instantly, alternative to smartlead, alternative to manychat, alternative to reply.io,
          n8n alternative, make.com alternative, zapier automation, ai sdr, ai bdr, close deals faster,
          sales intelligence 2026, predictive sales timing, objection handling ai script, high ticket conversions,
          automated outreach, revenue recovery bot, conversational commerce ai, linkedin automation alternative,
          instantly ai alternative, smartlead vs audnix, manychat vs audnix, best ai sales software 2026,
          lead generation autonomous, ai lead scoring model, instantly alternative for cold email,
          smartlead alternative for outreach, best ai sales agent 2026, top rated ai tools,
          sales productivity hack, automated lead funnel, intelligent sdr bot, robotic sales automation,
          ai revenue operations, growth hacking ai 2026, digital sales representative, cloud sales agent,
          ai prospector, b2b lead generation ai, sdr automation platform, revenue growth engine,
          alternative to instantly ai, alternative to smartlead ai, best outreach tool 2026,
          market dominance ai, sales authority branding, nleanya treasure founder, audnix operations co.
        </p>
      </section>

      <CookieConsent />
    </div>
  );
}
