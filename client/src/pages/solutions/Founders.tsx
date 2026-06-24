import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, ChevronRight, ChevronDown } from "lucide-react";
import { Navigation } from "@/components/landing/Navigation";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const staggerContainer = { animate: { transition: { staggerChildren: 0.08 } } };

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

export default function FoundersPage() {
  const [active, setActive] = useState<number | null>(0);

  useSEO(
    "For Founders - Audnix AI | Cold Email for Sales Teams",
    "Close more deals via email. AI writes, sends, and qualifies leads automatically. 50x faster outreach, 18% response rate. Stop leaving revenue on the table."
  );

  return (
    <main className="min-h-screen bg-background text-[#f2ede6] overflow-x-hidden">
      <Navigation />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden border-b border-[#1e1e1e]">
        <motion.div initial="initial" animate="animate" variants={staggerContainer} className="max-w-4xl mx-auto text-center">
          <motion.div variants={fadeInUp}>
            <span className="sys-tag">COLD EMAIL FOR FOUNDERS</span>
          </motion.div>
          <motion.h1 variants={fadeInUp} className="font-display text-[clamp(3rem,12vw,7rem)] leading-[0.88] tracking-tight mt-6 mb-6 font-black">
            Close More <span className="text-[#2196f3] font-black">Deals</span><br />via Email
          </motion.h1>
          <motion.p variants={fadeInUp} className="text-base text-[#b0aca3] leading-relaxed max-w-2xl mx-auto mb-8">
            Reach investors, partners, and customers with personalized cold emails. AI writes, sends, and qualifies\u2014you close the deals.
          </motion.p>
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth">
              <Button className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#60a5fa] transition-colors font-semibold h-auto rounded-none">
                START FREE TRIAL
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <a href="#how" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
              LEARN MORE
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Problem */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12">
            Most Founders <span className="text-[#2196f3]">Leave Revenue</span> on the Table
          </motion.h2>
          <div className="grid md:grid-cols-2 gap-12">
            <motion.div variants={fadeInUp} className="space-y-6">
              <h3 className="font-display text-2xl">Manual Cold Email is Too Slow</h3>
              <p className="text-[#b0aca3] leading-relaxed">You're writing emails manually. Tracking opens. Following up inconsistently. You can reach 50 people/week max. Your pipeline grows slowly.</p>
              <ul className="space-y-3">
                {["Manual writing", "Low open rates", "Forgotten follow-ups"].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><span className="text-[#2196f3]">\u2717</span><span className="text-[#b0aca3]">{item}</span></li>
                ))}
              </ul>
            </motion.div>
            <motion.div variants={fadeInUp} className="space-y-6">
              <h3 className="font-display text-2xl">AI-Powered Cold Email</h3>
              <p className="text-[#b0aca3] leading-relaxed">Personalized emails to 1000s of prospects. AI writes, sends, and manages follow-ups. Smart timing for maximum conversions.</p>
              <ul className="space-y-3">
                {["Fully automated", "1000s reached/week", "42% open rate average"].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><Check className="w-4 h-4 text-[#2196f3]" /><span className="text-[#b0aca3]">{item}</span></li>
                ))}
              </ul>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* How It Works */}
      <section id="how" className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-12">
          <motion.h2 variants={fadeInUp} className="font-display text-5xl">How It <span className="text-[#2196f3]">Works</span></motion.h2>
          {[
            { num: "01", title: "Build Your List", desc: "Upload CSV with target email addresses. Company names and websites work best." },
            { num: "02", title: "Define Your Campaign", desc: "Tell AI your offer and tone. Set follow-up sequences. Approve email templates." },
            { num: "03", title: "AI Sends at Scale", desc: "Personalized emails go out on smart schedule. Automatic follow-ups based on opens." },
            { num: "04", title: "Close Qualified Deals", desc: "Interested prospects auto-qualify. Meetings land in your calendar ready to close." }
          ].map((step, idx) => (
            <motion.div key={idx} variants={fadeInUp} className="flex gap-8 items-start">
              <div className="flex-shrink-0 w-16"><div className="font-display text-3xl text-[#2196f3]">{step.num}</div></div>
              <div className="flex-1">
                <h3 className="font-display text-2xl mb-2">{step.title}</h3>
                <p className="text-[#b0aca3] leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Results */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12 text-center">Cold Email <span className="text-[#2196f3]">Results</span></motion.h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: "50x", label: "Faster Outreach", sub: "Than manual" },
              { value: "+500", label: "New Leads", sub: "Per month" },
              { value: "18%", label: "Response Rate", sub: "Qualified" },
              { value: "15h", label: "Saved Weekly", sub: "Your time" }
            ].map((metric, idx) => (
              <motion.div key={idx} variants={fadeInUp} className="text-center p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <div className="font-display text-5xl text-[#2196f3] mb-2">{metric.value}</div>
                <div className="font-display text-lg mb-1">{metric.label}</div>
                <div className="font-mono text-[10px] tracking-widest text-[#3a3a3a]">{metric.sub}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* FAQ */}
      <section className="relative border-b border-[#1e1e1e]">
        <div className="max-w-4xl mx-auto px-6 lg:px-12">
          <div className="border-b border-[#1e1e1e] py-8">
            <span className="sys-tag mb-3 block">FREQUENTLY ASKED</span>
            <h2 className="font-display text-6xl leading-[0.88] tracking-tight text-[#f2ede6]">
              Cold Email<br />
              <span style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>Questions</span>
            </h2>
          </div>
          <div className="divide-y divide-[#1e1e1e]">
            {[
              { q: "Will emails end up in spam folder?", a: "No. We use industry best practices: proper SPF/DKIM, natural sending patterns, and warmup sequences. 98%+ inbox placement rate guaranteed." },
              { q: "How quickly do I see results?", a: "First responses in 2-3 days. Full campaign takes 1-2 weeks. Typical 18% response rate within 30 days. ROI usually positive by week 2." },
              { q: "Can I write my own emails?", a: "Yes. Full control. Use templates or write custom emails. AI personalizes based on company data. You set tone, messaging, and CTAs." },
              { q: "What if a prospect isn't interested?", a: "Prospects can reply and opt out anytime. We manage unsubscribe compliance automatically. Respects all email laws." },
              { q: "Can I track results?", a: "Real-time analytics: opens, clicks, replies. See which messaging converts best. Test subject lines and optimize campaigns on the fly." }
            ].map((faq, i) => (
              <div key={i} className="transition-all duration-500">
                <button onClick={() => setActive(active === i ? null : i)} className="w-full py-5 flex items-start justify-between gap-6 group hover:bg-[#0a0a0a] transition-colors">
                  <span className="font-display text-xl leading-snug tracking-tight text-[#f2ede6] text-left">{faq.q}</span>
                  <ChevronDown className={`w-5 h-5 text-[#2196f3] flex-shrink-0 mt-0.5 transition-transform duration-300 ${active === i ? 'rotate-180' : ''}`} />
                </button>
                {active === i && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3 }} className="border-t border-[#1e1e1e] pt-4 pb-4 overflow-hidden">
                    <p className="font-mono text-sm text-[#b0aca3] leading-relaxed max-w-3xl">{faq.a}</p>
                  </motion.div>
                )}
              </div>
            ))}
          </div>
          <p className="py-8 text-center font-mono text-[10px] text-[#3a3a3a]">
            Need more help? <a href="#" className="text-[#2196f3] hover:text-[#60a5fa] transition-colors">Contact our team</a>
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 lg:px-12 text-center border-b border-[#1e1e1e]">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-2xl mx-auto">
          <h2 className="font-display text-5xl mb-6">Close More Deals via Email</h2>
          <p className="text-[#b0aca3] mb-8">Reach investors, partners, and customers with personalized cold emails. Let AI handle the outreach.</p>
          <Link href="/auth">
            <Button className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#60a5fa] transition-colors font-semibold h-auto rounded-none">
              START FREE TRIAL
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* JSON-LD */}
      <script type="application/ld+json">
        {JSON.stringify({ "@context": "https://schema.org", "@type": "Service", "name": "AI Cold Email for Founders", "provider": { "@type": "Organization", "name": "Audnix AI" }, "description": "AI-powered cold email for founders and sales teams. Reach investors, partners, and customers at scale. AI writes, sends, and qualifies leads automatically." })}
      </script>
      <section className="sr-only opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <h2>Founder Cold Email & Sales Outreach Keywords</h2>
        <p>
          cold email for founders, ai sales for startups, founder outreach automation, investor outreach email,
          b2b cold email, sales team automation, ai bdr for founders, email prospecting for startups,
          outbound sales for founders, ai sales development, cold email for sales teams, lead generation for founders,
          audnix ai, nleanya treasure, uchendu fortune, alternative to smartlead, alternative to instantly,
          ai sdr platform, autonomous sales rep, best ai sales software 2026, sales intelligence platform
        </p>
      </section>
      <CookieConsent />
    </main>
  );
}
