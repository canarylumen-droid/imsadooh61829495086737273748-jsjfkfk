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

export default function CreatorsPage() {
  const [active, setActive] = useState<number | null>(0);

  useSEO(
    "For Creators - Audnix AI | Cold Email & Audience Growth",
    "Build your email list fast with AI-powered cold email campaigns. 42% open rates, 18% response rates. Send personalized emails to 1000s of prospects automatically."
  );

  return (
    <main className="min-h-screen bg-background text-[#f2ede6] overflow-x-hidden">
      <Navigation />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden border-b border-[#1e1e1e]">
        <motion.div initial="initial" animate="animate" variants={staggerContainer} className="max-w-4xl mx-auto text-center">
          <motion.div variants={fadeInUp}>
            <span className="sys-tag">COLD EMAIL CAMPAIGNS</span>
          </motion.div>
          <motion.h1 variants={fadeInUp} className="font-display text-[clamp(3rem,12vw,7rem)] leading-[0.88] tracking-tight mt-6 mb-6 font-black">
            Build Your Email <span className="text-[#2196f3] font-black">List Fast</span>
          </motion.h1>
          <motion.p variants={fadeInUp} className="text-base text-[#b0aca3] leading-relaxed max-w-2xl mx-auto mb-8">
            Send personalized cold emails at scale. AI writes, sends, and manages follow-ups automatically. Get qualified leads without touching a keyboard.
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
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12">Cold Email Done <span className="text-[#2196f3]">Better</span></motion.h2>
          <div className="grid md:grid-cols-2 gap-12">
            <motion.div variants={fadeInUp} className="space-y-6">
              <h3 className="font-display text-2xl">Manual Cold Email Doesn't Scale</h3>
              <p className="text-[#b0aca3] leading-relaxed">You're manually writing emails and tracking responses. 5-10 hours per week wasted. Low open rates. Forgetting follow-ups.</p>
              <ul className="space-y-3">
                {["Manual writing", "Slow sequences", "No personalization"].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><span className="text-[#2196f3]">\u2717</span><span className="text-[#b0aca3]">{item}</span></li>
                ))}
              </ul>
            </motion.div>
            <motion.div variants={fadeInUp} className="space-y-6">
              <h3 className="font-display text-2xl">AI-Powered Cold Email</h3>
              <p className="text-[#b0aca3] leading-relaxed">Personalized emails at scale. Smart follow-ups. AI learns what works and optimizes every campaign automatically.</p>
              <ul className="space-y-3">
                {["Fully automated", "Personalized at scale", "3x better response rates"].map((item, i) => (
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
            { num: "01", title: "Upload Your List", desc: "CSV with email addresses. AI prepares personalization data in minutes." },
            { num: "02", title: "Set Your Campaign", desc: "Define your offer, tone, and follow-up sequence. AI handles the rest." },
            { num: "03", title: "AI Sends & Tracks", desc: "Personalized emails go out. Smart timing. Automatic follow-ups at the right moment." },
            { num: "04", title: "You Get Responses", desc: "Qualified leads land in your inbox. Meetings ready to book." }
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
              { value: "42%", label: "Open Rate", sub: "vs 25% average" },
              { value: "18%", label: "Response Rate", sub: "Highly qualified" },
              { value: "10h", label: "Saved Weekly", sub: "Your time back" },
              { value: "100x", label: "More Outreach", sub: "Per campaign" }
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
              { q: "Will emails end up in spam?", a: "No. We use industry best practices for deliverability. Smart warmup sequences, proper SPF/DKIM setup, and natural sending patterns. 98%+ inbox placement." },
              { q: "How long before I see results?", a: "First responses in 2-3 days. Full campaign momentum takes 1-2 weeks. Average 18% response rate within 30 days." },
              { q: "Can I customize the email templates?", a: "Complete control. Write your own emails or use AI templates. Set tone, messaging, CTAs. We personalize based on your data." },
              { q: "What data do you need to personalize?", a: "Company name, industry, and website are ideal. AI extracts additional insights. More data = better personalization = higher response rates." },
              { q: "Can I pause or stop campaigns?", a: "Yes, anytime. Full control over scheduling, pausing, and recipient lists. View real-time analytics and adjust on the fly." }
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
          <h2 className="font-display text-5xl mb-6">Scale Cold Email Today</h2>
          <p className="text-[#b0aca3] mb-8">Send personalized emails to 1000s of prospects. Get qualified responses automatically.</p>
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
        {JSON.stringify({ "@context": "https://schema.org", "@type": "Service", "name": "AI Cold Email for Creators", "provider": { "@type": "Organization", "name": "Audnix AI" }, "description": "AI-powered cold email campaigns for creators. Build your list, send personalized emails at scale, and get qualified responses automatically." })}
      </script>
      <section className="sr-only opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <h2>Creator Cold Email & AI Outreach Keywords</h2>
        <p>
          cold email for creators, ai email outreach, build email list, email marketing automation,
          creator email campaigns, personalized cold email, ai email writer, email list building tool,
          outreach automation for creators, email marketing for influencers, ai sales for creators,
          audience growth email, audnix ai, nleanya treasure, alternative to instantly, ai sales agent,
          cold email automation, b2b lead generation, email outreach software 2026
        </p>
      </section>
      <CookieConsent />
    </main>
  );
}
