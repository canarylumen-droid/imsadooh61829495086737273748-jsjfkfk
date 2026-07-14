import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, ChevronDown, TrendingUp, BarChart3, Zap } from 'lucide-react';
import ScrollStack, { ScrollStackItem } from '@/components/scroll-stack/scroll-stack';
import Threads from '@/components/hero-effects/Threads';
import { Navigation } from '@/components/new-landing/navigation';
import { FooterSection } from '@/components/new-landing/footer-section';

const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const staggerContainer = { animate: { transition: { staggerChildren: 0.08 } } };

export default function LeadRecoveryPage() {
  const [active, setActive] = useState<number | null>(0);

  useEffect(() => {
    document.title = "AUDNIX — Lead Recovery | Resurrect Dead Leads";
    let meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Recover 15-30% of dead leads automatically with AUDNIX. AI monitors buying signals and re-engages cold pipeline with personalized messaging.");
  }, []);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050505] text-[#f2ede6]">
      <Navigation />

      {/* Hero Section with Threads */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden border-b border-[#1e1e1e]">
        <div className="absolute inset-0 z-0">
          <Threads color={[0.13, 0.45, 0.95]} amplitude={1.2} distance={0} enableMouseInteraction={true} />
        </div>
        
        <motion.div initial="initial" animate="animate" variants={staggerContainer} className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div variants={fadeInUp}>
            <span className="sys-tag">LEAD RECOVERY</span>
          </motion.div>

          <motion.h1 variants={fadeInUp} className="font-display text-[clamp(3rem,12vw,7rem)] leading-[0.88] tracking-tight mt-6 mb-6 font-black">
            Resurrect <span className="text-[#2196f3] font-black">Dead</span> Leads
          </motion.h1>

          <motion.p variants={fadeInUp} className="text-base text-[#5a5a5a] leading-relaxed max-w-2xl mx-auto mb-8">
            30% of your pipeline went cold. Audnix re-engages them automatically—at the right time, with the right message. Recover deals you thought were lost forever.
          </motion.p>

          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/signup" className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
              START RECOVERY
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
              LEARN MORE
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* ScrollStack Section */}
      <ScrollStack className="h-screen bg-[#050505] border-b border-[#1e1e1e]" useWindowScroll={true} itemScale={0.04} baseScale={0.80}>
        <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
          <div className="flex items-center gap-6 h-full px-8">
            <div className="text-5xl"><TrendingUp className="w-16 h-16 text-[#2196f3]" /></div>
            <div>
              <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">15-30% Recovery Rate</h3>
              <p className="text-[#5a5a5a]">Dead pipeline reopened automatically within 90 days</p>
            </div>
          </div>
        </ScrollStackItem>

        <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
          <div className="flex items-center gap-6 h-full px-8">
            <div className="text-5xl"><BarChart3 className="w-16 h-16 text-[#2196f3]" /></div>
            <div>
              <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">+$100K Recovered</h3>
              <p className="text-[#5a5a5a]">Average revenue per 1,000 dead leads recovered</p>
            </div>
          </div>
        </ScrollStackItem>

        <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
          <div className="flex items-center gap-6 h-full px-8">
            <div className="text-5xl"><Zap className="w-16 h-16 text-[#2196f3]" /></div>
            <div>
              <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">24/7 Monitoring</h3>
              <p className="text-[#5a5a5a]">Constantly watching for re-engagement opportunities</p>
            </div>
          </div>
        </ScrollStackItem>
      </ScrollStack>

      {/* Problem & Solution */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="grid md:grid-cols-2 gap-12">
          <motion.div variants={fadeInUp} className="space-y-6">
            <h2 className="font-display text-4xl">The Cold Pipeline Crisis</h2>
            <p className="text-[#5a5a5a] leading-relaxed">
              Your team closes deals. They move on. But 30% say "not now." Those leads sit in your CRM, untouched, for 6+ months. When circumstances change, they never hear from you again.
            </p>
            <ul className="space-y-3">
              {['Lost opportunities', 'No automated re-engagement', 'Revenue slipping away'].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-[#f2ede6]">
                  <div className="w-2 h-2 bg-[#2196f3] rounded-full" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div variants={fadeInUp} className="space-y-6">
            <h2 className="font-display text-4xl">Smart Re-engagement</h2>
            <p className="text-[#5a5a5a] leading-relaxed">
              Audnix watches your cold pipeline 24/7. When conditions align—new budget cycle, company growth, team changes—it automatically re-engages with fresh value and relevant messaging.
            </p>
            <ul className="space-y-3">
              {['Automatic trigger detection', 'Personalized messaging', 'Multi-channel outreach'].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-[#f2ede6]">
                  <Check className="w-4 h-4 text-[#2196f3]" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-12">
          <motion.h2 variants={fadeInUp} className="font-display text-5xl text-center">Recovery Process</motion.h2>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              { num: '01', title: 'Identify', desc: 'AI scans your CRM for stalled deals' },
              { num: '02', title: 'Monitor', desc: 'Watch for buying signal changes' },
              { num: '03', title: 'Engage', desc: 'Auto-trigger personalized outreach' },
              { num: '04', title: 'Close', desc: 'Reopen deals with fresh context' }
            ].map((step, idx) => (
              <motion.div key={idx} variants={fadeInUp} className="p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <div className="font-display text-4xl text-[#2196f3] mb-2">{step.num}</div>
                <h3 className="font-display text-xl mb-2 text-[#f2ede6]">{step.title}</h3>
                <p className="text-[#5a5a5a] text-sm">{step.desc}</p>
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
              Lead Recovery<br />
              <span style={{ WebkitTextStroke: '1px #3a3a3a', color: 'transparent' }}>Questions</span>
            </h2>
          </div>

          <div className="divide-y divide-[#1e1e1e]">
            {[
              { q: 'How does it know when to re-engage?', a: 'Monitors 150+ signals: funding, job postings, budget cycles. Re-engages when conditions align.' },
              { q: 'Will it spam our prospects?', a: 'No. One strategic message when conditions align. Respectful cadence rules always apply.' },
              { q: 'What recovery rates should we expect?', a: '15-30% recovery rate. Industry average is 12-18%.' },
              { q: 'Can we customize recovery templates?', a: 'Yes. Upload playbooks. AI personalizes based on why each prospect went cold.' },
              { q: 'Does it work with my CRM?', a: 'Yes. Salesforce, HubSpot, Pipedrive, and 50+ others. Seamless integration.' }
            ].map((faq, i) => (
              <div key={i} className="transition-all duration-500">
                <button
                  onClick={() => setActive(active === i ? null : i)}
                  className="w-full py-5 flex items-start justify-between gap-6 group hover:bg-[#0a0a0a] transition-colors"
                >
                  <span className="font-display text-lg lg:text-xl leading-snug tracking-tight text-[#f2ede6] text-left">
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-[#2196f3] flex-shrink-0 mt-0.5 transition-transform duration-300 ${
                      active === i ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {active === i && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="border-t border-[#1e1e1e] pt-4 pb-4 overflow-hidden"
                  >
                    <p className="font-mono text-xs lg:text-sm text-[#5a5a5a] leading-relaxed max-w-3xl">
                      {faq.a}
                    </p>
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
      <section className="py-20 px-6 lg:px-12 text-center border-b border-[#1e1e1e]">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-2xl mx-auto">
          <h2 className="font-display text-5xl mb-4">Ready to Recover Lost Revenue?</h2>
          <p className="text-[#5a5a5a] mb-8">Start with 30 days free. See how many deals you can resurrect automatically.</p>
          <a href="/signup" className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
            ENABLE RECOVERY
            <ChevronRight className="w-4 h-4" />
          </a>
        </motion.div>
      </section>

      <FooterSection />
    </main>
  );
}
