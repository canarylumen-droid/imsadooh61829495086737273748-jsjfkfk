import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, ChevronDown, Brain, Shield, Zap } from 'lucide-react';
import ScrollStack, { ScrollStackItem } from '@/components/scroll-stack/scroll-stack';
import Hyperspeed from '@/components/hero-effects/Hyperspeed';
import { Navigation } from '@/components/new-landing/navigation';
import { FooterSection } from '@/components/new-landing/footer-section';

const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const staggerContainer = { animate: { transition: { staggerChildren: 0.08 } } };

export default function ObjectionHandlingPage() {
  const [active, setActive] = useState<number | null>(0);

  useEffect(() => {
    document.title = "AUDNIX — Objection Handling | AI Sales Coaching";
    let meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Never lose a deal to objections. AUDNIX AI predicts buyer concerns, coaches reps in real-time, and delivers perfect responses every time.");
  }, []);

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050505] text-[#f2ede6]">
      <Navigation />

      {/* Hero Section with Hyperspeed */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden border-b border-[#1e1e1e]">
        <div className="absolute inset-0 z-0">
          <Hyperspeed effectOptions={{}} />
        </div>
        
        <motion.div initial="initial" animate="animate" variants={staggerContainer} className="relative z-10 max-w-5xl mx-auto text-center">
          <motion.div variants={fadeInUp}>
            <span className="sys-tag">OBJECTION MASTERY</span>
          </motion.div>

          <motion.h1 variants={fadeInUp} className="font-display text-[clamp(3rem,12vw,7rem)] leading-[0.88] tracking-tight mt-6 mb-6 font-black">
            Never Lose a Deal to <span className="text-[#2196f3] font-black">Objections</span>
          </motion.h1>

          <motion.p variants={fadeInUp} className="text-base text-[#5a5a5a] leading-relaxed max-w-2xl mx-auto mb-8">
            75% of sales cycles hit objections. AI-powered handling anticipates buyer concerns, delivers perfect responses, and keeps deals moving forward.
          </motion.p>

          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/signup" className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
              MASTER OBJECTIONS
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
              SEE HOW IT WORKS
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* ScrollStack Section */}
      <ScrollStack className="h-screen bg-[#050505] border-b border-[#1e1e1e]" useWindowScroll={true} itemScale={0.04} baseScale={0.80}>
        <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
          <div className="flex items-center gap-6 h-full px-8">
            <div className="text-5xl"><Brain className="w-16 h-16 text-[#2196f3]" /></div>
            <div>
              <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Predict Objections</h3>
              <p className="text-[#5a5a5a]">AI anticipates buyer concerns before they arise</p>
            </div>
          </div>
        </ScrollStackItem>

        <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
          <div className="flex items-center gap-6 h-full px-8">
            <div className="text-5xl"><Shield className="w-16 h-16 text-[#2196f3]" /></div>
            <div>
              <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Perfect Responses</h3>
              <p className="text-[#5a5a5a]">Real-time guidance during critical moments</p>
            </div>
          </div>
        </ScrollStackItem>

        <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
          <div className="flex items-center gap-6 h-full px-8">
            <div className="text-5xl"><Zap className="w-16 h-16 text-[#2196f3]" /></div>
            <div>
              <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Deal Progression</h3>
              <p className="text-[#5a5a5a]">Keep every opportunity moving forward</p>
            </div>
          </div>
        </ScrollStackItem>
      </ScrollStack>

      {/* The Challenge */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="grid md:grid-cols-2 gap-12">
          <motion.div variants={fadeInUp} className="space-y-6">
            <h2 className="font-display text-4xl">Why Deals Stall</h2>
            <p className="text-[#5a5a5a] leading-relaxed">
              Objections are inevitable. Budget concerns, competing priorities, timing issues—your reps face them constantly. Without the right response, the deal dies.
            </p>
            <ul className="space-y-3">
              {['Lost response opportunities', 'Inconsistent handling', 'Deals that could close...don\'t'].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-[#f2ede6]">
                  <div className="w-2 h-2 bg-[#2196f3] rounded-full" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>

          <motion.div variants={fadeInUp} className="space-y-6">
            <h2 className="font-display text-4xl">AI-Powered Mastery</h2>
            <p className="text-[#5a5a5a] leading-relaxed">
              Audnix predicts objections, coaches your reps in real-time, and ensures perfect responses every single time. Deals stay on track. Win rates go up.
            </p>
            <ul className="space-y-3">
              {['Smart prediction', 'Real-time coaching', 'Proven outcomes'].map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-[#f2ede6]">
                  <Check className="w-4 h-4 text-[#2196f3]" />
                  {item}
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      </section>

      {/* Top Objections */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-5xl text-center mb-12">Most Common Objections</motion.h2>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { obj: '"We need more time"', handle: 'AI identifies urgency drivers and creates timeline pressure' },
              { obj: '"It\'s too expensive"', handle: 'ROI counters tailored to their specific metrics' },
              { obj: '"We\'re comparing options"', handle: 'Differentiation reminders highlighting unique value' },
              { obj: '"We\'ll revisit next quarter"', handle: 'Immediate value demonstrations to accelerate buying' },
              { obj: '"We need to align internally"', handle: 'Multi-stakeholder engagement strategies' },
              { obj: '"Your competitor is cheaper"', handle: 'Strategic positioning against competitive threats' }
            ].map((item, idx) => (
              <motion.div key={idx} variants={fadeInUp} className="p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <h3 className="font-semibold text-[#2196f3] mb-3">{item.obj}</h3>
                <p className="text-[#5a5a5a] text-sm">{item.handle}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Benefits */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-12">
          <motion.h2 variants={fadeInUp} className="font-display text-5xl text-center">The Results</motion.h2>

          <div className="grid md:grid-cols-4 gap-6">
            {[
              { metric: '32%', label: 'Higher Win Rates', sub: 'When objections are mastered' },
              { metric: '48%', label: 'Faster Cycles', sub: 'Deals progress without stalling' },
              { metric: '45%', label: 'Deal Size Increase', sub: 'Better negotiation outcomes' },
              { metric: '24/7', label: 'AI Coaching', sub: 'Always ready guidance' }
            ].map((item, idx) => (
              <motion.div key={idx} variants={fadeInUp} className="text-center p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <div className="font-display text-4xl text-[#2196f3] mb-2">{item.metric}</div>
                <div className="font-display text-lg mb-1">{item.label}</div>
                <div className="text-xs text-[#5a5a5a]">{item.sub}</div>
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
              Objection<br />
              <span style={{ WebkitTextStroke: '1px #3a3a3a', color: 'transparent' }}>Handling</span>
            </h2>
          </div>

          <div className="divide-y divide-[#1e1e1e]">
            {[
              { q: 'How does the AI predict objections?', a: 'Machine learning on 50,000+ sales calls. AI recognizes conversation patterns and signals that precede common objections.' },
              { q: 'Is this real-time coaching?', a: 'Yes. During live calls, reps see suggested responses in their CRM or call dialer interface immediately.' },
              { q: 'Does it work for all industries?', a: 'Designed for B2B SaaS, enterprise sales, and high-ticket deals. Works across industries with proven success.' },
              { q: 'Can we customize the responses?', a: 'Absolutely. Upload your playbooks and company positioning. AI personalizes all guidance.' },
              { q: 'Will reps accept AI coaching?', a: 'They love it. No judgment, just immediate support. Usage increases after first week of training.' }
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
          <h2 className="font-display text-5xl mb-4">Transform Objections Into Wins</h2>
          <p className="text-[#5a5a5a] mb-8">Real-time AI coaching that turns deal stalls into closed revenue.</p>
          <a href="/signup" className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
            ENABLE OBJECTION HANDLING
            <ChevronRight className="w-4 h-4" />
          </a>
        </motion.div>
      </section>

      <FooterSection />
    </main>
  );
}
