import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, ChevronDown, Check } from 'lucide-react';
import DotGrid from '@/components/dot-grid/DotGrid';
import { Navigation } from '@/components/new-landing/navigation';
import { FooterSection } from '@/components/new-landing/footer-section';
import { ROICalculator } from '@/components/new-landing/roi-calculator';

const PLANS = [
  {
    id: '01',
    name: 'ACCELERATOR TRIAL',
    tagline: '3-day free trial',
    price: { mo: 0, yr: 0 },
    features: [
      '10,000 lead sync',
      '2 Connected Mailboxes',
      '100 AI Voice Minutes',
      'Basic Cadence',
      'Standard Support',
    ],
    cta: 'START FREE TRIAL',
    highlight: false,
  },
  {
    id: '02',
    name: 'GROWTH',
    tagline: 'Scale your pipeline',
    price: { mo: 49, yr: 39 },
    features: [
      '2,500 leads / month',
      '5 Connected Mailboxes',
      '250 AI Voice Minutes',
      'Autonomous Follow-ups',
      'Smart CRM Integration',
      'Performance Analytics',
      'Conversion Tracking',
    ],
    cta: 'START TRIAL',
    highlight: false,
  },
  {
    id: '03',
    name: 'PERFORMANCE',
    tagline: 'Enterprise-grade closing',
    price: { mo: 99, yr: 79 },
    features: [
      '7,000 leads / month',
      '15 Connected Mailboxes',
      '1,000 AI Voice Minutes',
      'Deep Lead Insights',
      'Intent Recognition',
      '110+ Objection Mastery',
      'Strategic ROI Mapping',
      'Priority Support',
    ],
    cta: 'START TRIAL',
    highlight: true,
  },
  {
    id: '04',
    name: 'ENTERPRISE',
    tagline: 'Custom scaling',
    price: { mo: null, yr: null },
    features: [
      'Unlimited leads',
      'Unlimited Mailboxes',
      'Unlimited Voice Minutes',
      'Voice Cloning & Training',
      'Smart Auto-Tagging',
      'Drop-off & Churn Detection',
      'Dedicated Success Manager',
      '24/7 Priority Support',
    ],
    cta: 'CONTACT SALES',
    highlight: false,
  },
];

const PRICING_FAQS = [
  {
    q: 'Can I change plans anytime?',
    a: 'Yes. Upgrade or downgrade your plan anytime. Changes take effect on your next billing cycle. No penalties or long-term contracts.',
  },
  {
    q: 'What payment methods do you accept?',
    a: 'We accept all major credit cards (Visa, Mastercard, Amex), wire transfers for enterprise accounts, and ACH payments. Invoicing available for annual plans.',
  },
  {
    q: 'Do you offer discounts for annual billing?',
    a: 'Yes. All plans include 20% savings when you pay annually. Plus, enterprise customers get custom volume discounts.',
  },
  {
    q: 'What\'s included in the free trial?',
    a: 'Your 3-day trial includes full access to all features: 10,000 lead syncs, AI voice minutes, integrations, and everything except multi-user seats which require upgrade.',
  },
  {
    q: 'Is there a limit on how many team members can use my account?',
    a: 'Growth and Performance plans include 3 team seats. Enterprise includes unlimited seats. Add additional seats at $50/user/month on Growth and Performance.',
  },
];

const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const staggerContainer = { animate: { transition: { staggerChildren: 0.08 } } };

export default function PricingPage() {
  const [annual, setAnnual] = useState(true);
  const [vis, setVis] = useState(false);
  const [active, setActive] = useState<number | null>(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "AUDNIX — Pricing Plans & Transparent Pricing";
    let meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "Scale revenue with AUDNIX pricing. Transparent plans from free trial to enterprise. AI sales agents, cold email, voice intelligence, and objection handling.");
  }, []);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <main className="relative min-h-screen bg-[#050505] text-[#f2ede6] overflow-x-hidden">
      <Navigation />

      {/* Hero with DotGrid */}
      <section className="relative min-h-screen flex items-center justify-center pt-20 overflow-hidden border-b border-[#1e1e1e]">
        <div className="absolute inset-0 z-0">
          <DotGrid
            dotSize={8}
            gap={30}
            baseColor="#3a3a3a"
            activeColor="#2196f3"
            proximity={120}
            shockRadius={250}
            shockStrength={5}
            resistance={750}
            returnDuration={1.5}
            style={{ height: '100%', width: '100%' }}
          />
        </div>

        <motion.div
          initial="initial"
          animate="animate"
          variants={staggerContainer}
          className="relative z-10 max-w-5xl mx-auto text-center px-6 lg:px-12"
        >
          <motion.div variants={fadeInUp}>
            <span className="sys-tag">TRANSPARENT PRICING</span>
          </motion.div>

          <motion.h1 variants={fadeInUp} className="font-display text-[clamp(3rem,12vw,7rem)] leading-[0.88] tracking-tight mt-6 mb-6 font-black">
            Scale Revenue,<br />
            <span className="text-[#f2ede6] font-black">Not Costs</span>
          </motion.h1>

          <motion.p variants={fadeInUp} className="text-base text-[#5a5a5a] leading-relaxed max-w-2xl mx-auto mb-8">
            One pricing model. No hidden fees. No surprises. Choose the plan that fits your stage and scale as you grow.
          </motion.p>

          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="#plans" className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
              VIEW PLANS
              <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
              TALK TO SALES
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Pricing Section */}
      <section id="plans" ref={ref} className="relative border-b border-[#1e1e1e] bg-[#080808]">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

          {/* Header */}
          <div
            className={`border-b border-[#1e1e1e] py-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 transition-all duration-500 ${vis ? 'opacity-100' : 'opacity-0'}`}
          >
            <div>
              <span className="sys-tag mb-3 block">PLANS</span>
              <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
                CHOOSE YOUR<br />
                <span style={{ WebkitTextStroke: '1px #3a3a3a', color: 'transparent' }}>GROWTH PLAN</span>
              </h2>
            </div>

            {/* Billing toggle */}
            <div className="flex items-center gap-4">
              <span className={`font-mono text-[11px] tracking-widest transition-colors ${!annual ? 'text-[#f2ede6]' : 'text-[#3a3a3a]'}`}>MONTHLY</span>
              <button
                onClick={() => setAnnual(!annual)}
                className="relative w-12 h-6 bg-[#1e1e1e] border border-[#2e2e2e] flex items-center"
              >
                <div className={`w-4 h-4 bg-[#2196f3] transition-transform duration-300 mx-1 ${annual ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <span className={`font-mono text-[11px] tracking-widest transition-colors ${annual ? 'text-[#f2ede6]' : 'text-[#3a3a3a]'}`}>ANNUAL</span>
              {annual && (
                <span className="font-mono text-[9px] tracking-widest border border-[#2196f3]/40 text-[#2196f3] px-2 py-1">
                  SAVE_20%
                </span>
              )}
            </div>
          </div>

          {/* Plans grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 border-b border-[#1e1e1e]">
            {PLANS.map((p, i) => (
              <div
                key={p.id}
                className={`border-r border-b border-[#1e1e1e] last:border-r-0 relative transition-all duration-500 ${
                  p.id === '04' ? 'md:col-span-2 lg:col-span-3' : ''
                } ${
                  p.highlight ? 'bg-[#0e0e0e]' : ''
                } ${vis ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
                style={{ transitionDelay: `${i * 80}ms` }}
              >
                {p.highlight && (
                  <div className="absolute top-0 left-0 right-0 h-px bg-[#2196f3]" />
                )}

                <div className="p-8 border-b border-[#1e1e1e]">
                  <div className="flex items-start justify-between mb-4">
                    <span className="font-mono text-[9px] text-[#3a3a3a]">{p.id}</span>
                    {p.highlight && (
                      <span className="font-mono text-[9px] tracking-widest border border-[#2196f3]/40 text-[#2196f3] px-2 py-1">
                        POPULAR
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-2xl lg:text-4xl text-[#f2ede6] mb-1">{p.name}</h3>
                  <p className="font-mono text-[10px] text-[#3a3a3a] tracking-wider">{p.tagline}</p>
                </div>

                <div className="p-8 border-b border-[#1e1e1e]">
                  {p.price.mo !== null ? (
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-5xl lg:text-6xl text-[#f2ede6]">
                        ${annual ? p.price.yr : p.price.mo}
                      </span>
                      <span className="font-mono text-[10px] text-[#3a3a3a]">/MONTH</span>
                    </div>
                  ) : (
                    <span className="font-display text-5xl text-[#f2ede6]">CUSTOM</span>
                  )}
                </div>

                <ul className="p-8 space-y-3 border-b border-[#1e1e1e]">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-3">
                      <Check className="w-4 h-4 text-[#2196f3] flex-shrink-0 mt-0.5" />
                      <span className="font-mono text-[11px] text-[#5a5a5a]">{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="p-8">
                  <a
                    href="#"
                    className={`w-full flex items-center justify-between font-mono text-[11px] tracking-widest px-5 py-4 transition-colors group ${
                      p.highlight
                        ? 'bg-[#2196f3] text-[#050505] hover:bg-[#60a5fa] font-semibold'
                        : 'border border-[#2e2e2e] text-[#5a5a5a] hover:border-[#2196f3]/40 hover:text-[#2196f3]'
                    }`}
                  >
                    {p.cta}
                    <span className="transition-transform group-hover:translate-x-1">→</span>
                  </a>
                </div>
              </div>
            ))}
          </div>

          <p className="py-5 text-center font-mono text-[10px] text-[#3a3a3a]">
            CANCEL ANYTIME · NO LONG-TERM CONTRACTS · 3-DAY FREE TRIAL
          </p>
        </div>
      </section>

      {/* Pricing FAQ */}
      <section className="relative border-b border-[#1e1e1e]">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

          {/* Header */}
          <div className="border-b border-[#1e1e1e] py-8">
            <div className="flex items-end justify-between mb-6">
              <div>
                <span className="sys-tag mb-3 block">PRICING FAQ</span>
                <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
                  BILLING<br />
                  <span style={{ WebkitTextStroke: '1px #3a3a3a', color: 'transparent' }}>QUESTIONS</span>
                </h2>
              </div>
            </div>
          </div>

          {/* FAQ list */}
          <div className="divide-y divide-[#1e1e1e]">
            {PRICING_FAQS.map((faq, i) => (
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

          {/* Divider */}
          <div className="border-t border-[#1e1e1e] py-12 text-center">
            <p className="font-mono text-[11px] text-[#3a3a3a] tracking-widest uppercase mb-4">
              Still have questions?
            </p>
            <a
              href="#"
              className="group inline-flex items-center gap-3 text-[#2196f3] font-mono text-sm tracking-widest hover:text-[#42a5f5] transition-colors"
            >
              CONTACT OUR TEAM
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </a>
          </div>

        </div>
      </section>

      {/* Comparison Section */}
      <section className="relative border-b border-[#1e1e1e]">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
          <div className="border-b border-[#1e1e1e] py-8">
            <span className="sys-tag mb-3 block">HOW WE COMPARE</span>
            <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
              AUDNIX vs<br />
              <span style={{ WebkitTextStroke: '1px #3a3a3a', color: 'transparent' }}>THE REST</span>
            </h2>
          </div>

          <div className="overflow-x-auto">
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
                  { feature: '24/7 Availability', audnix: '✓', sdr: '✗', other: '✓' },
                  { feature: '110+ Objection Handling', audnix: '✓', sdr: '✓', other: '✗' },
                  { feature: 'Voice Intelligence', audnix: '✓', sdr: '✗', other: '✗' },
                  { feature: 'Predictive Timing', audnix: '✓', sdr: '✗', other: '✗' },
                  { feature: 'CRM Integration', audnix: '✓', sdr: '✓', other: '△' },
                  { feature: 'Setup Time', audnix: '1 min', sdr: '30+ days', other: '7-14 days' },
                  { feature: 'Cost per Lead', audnix: '$0.05', sdr: '$5-10', other: '$0.50' },
                  { feature: 'Scalability', audnix: 'Unlimited', sdr: 'Limited', other: 'Limited' }
                ].map((row, idx) => (
                  <tr key={idx} className="border-b border-[#1e1e1e] hover:bg-[#0a0a0a] transition-colors">
                    <td className="py-4 px-6 font-mono text-[#f2ede6] text-xs lg:text-sm">{row.feature}</td>
                    <td className="py-4 px-6 text-center text-[#2196f3] font-semibold text-xs lg:text-sm">{row.audnix}</td>
                    <td className="py-4 px-6 text-center text-[#5a5a5a] text-xs lg:text-sm">{row.sdr}</td>
                    <td className="py-4 px-6 text-center text-[#5a5a5a] text-xs lg:text-sm">{row.other}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="py-8 text-center font-mono text-[10px] text-[#3a3a3a]">
            Want a detailed comparison? <a href="#" className="text-[#2196f3] hover:text-[#60a5fa] transition-colors">Download our comparison guide</a>
          </p>
        </div>
      </section>

      <ROICalculator />

      {/* CTA Section */}
      <section className="py-20 px-6 lg:px-12 text-center border-b border-[#1e1e1e]">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-2xl mx-auto">
          <h2 className="font-display text-5xl lg:text-6xl mb-4">Start Building Revenue Today</h2>
          <p className="text-[#5a5a5a] mb-8">All plans include a 3-day free trial. No credit card required. Cancel anytime.</p>
          <a href="/signup" className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
            START FREE TRIAL
            <ChevronRight className="w-4 h-4" />
          </a>
        </motion.div>
      </section>

      <FooterSection />
    </main>
  );
}
