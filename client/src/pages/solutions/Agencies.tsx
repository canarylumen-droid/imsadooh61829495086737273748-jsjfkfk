import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Check, Zap, Layers, TrendingUp, DollarSign } from 'lucide-react';
import ScrollStack, { ScrollStackItem } from '@/components/scroll-stack/scroll-stack';
import { Navigation } from '@/components/new-landing/navigation';
import { FooterSection } from '@/components/new-landing/footer-section';
import { TypingText } from '@/components/animations/typing-text';
import { GradientText, ShinyText, BlurText, ScrollReveal, GlareHover, ElectricBorder, FadeContent, ScrollFloat, CountUp, StaggeredList } from '@/components/animations/advanced-animations';

const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const slideInLeft = { initial: { opacity: 0, x: -40 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.6 } };
const slideInRight = { initial: { opacity: 0, x: 40 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.6 } };
const scaleIn = { initial: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.5 } };
const bounceIn = { initial: { opacity: 0, scale: 0.3 }, animate: { opacity: 1, scale: 1 }, transition: { type: 'spring', stiffness: 260, damping: 20 } };
const rotateIn = { initial: { opacity: 0, rotate: -10 }, animate: { opacity: 1, rotate: 0 }, transition: { duration: 0.5 } };
const zoomIn = { initial: { opacity: 0, scale: 0.5 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 0.5 } };
const blurIn = { initial: { opacity: 0, filter: 'blur(10px)' }, animate: { opacity: 1, filter: 'blur(0px)' }, transition: { duration: 0.6 } };
const slideUp = { initial: { opacity: 0, y: 60 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7 } };
const flipIn = { initial: { opacity: 0, rotateY: -90 }, animate: { opacity: 1, rotateY: 0 }, transition: { duration: 0.6 } };

const staggerContainer = { animate: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
const listItem = { initial: { opacity: 0, x: -10 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.3 } };

export default function AgenciesPage() {
  useEffect(() => {
    document.title = "AUDNIX — For Agencies | White-Label AI Sales Agents";
    let meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", "White-label AI sales agents for agencies. Scale from 10 to 100 clients without hiring. 70% margins, instant deployment, 24/7 closing under your brand.");
  }, []);

  return (
    <main className="min-h-screen bg-[#050505] text-[#f2ede6]">
      <Navigation />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden">
        <motion.div
          initial="initial"
          animate="animate"
          variants={staggerContainer}
          className="max-w-4xl mx-auto text-center"
        >
          <motion.div variants={slideInLeft}>
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#2196f3] uppercase">
              FOR AGENCIES & RESELLERS
            </span>
          </motion.div>

          <motion.h1
            variants={slideInRight}
            className="font-display text-[clamp(3rem,10vw,6rem)] leading-[0.88] tracking-tight mt-4 mb-6"
          >
            <ShinyText>Scale Without</ShinyText><br />
            <GradientText className="text-[clamp(3rem,10vw,6rem)]">Headcount</GradientText>
          </motion.h1>

          <motion.div variants={fadeInUp} className="mb-8">
            <p className="text-base text-[#5a5a5a] leading-relaxed max-w-2xl mx-auto">
              <TypingText 
                text="White-label AI agents that close deals under your brand. Add revenue without adding overhead. Your clients get results, you keep the margins."
                speed={30}
              />
            </p>
          </motion.div>

          <motion.div
            variants={scaleIn}
            className="flex flex-col sm:flex-row gap-4 justify-center"
          >
            <ElectricBorder>
              <a
                href="/get-started"
                className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#42a5f5] transition-colors font-semibold rounded"
              >
                START FREE TRIAL
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>
            </ElectricBorder>
            <ElectricBorder>
              <a
                href="#"
                className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors rounded"
              >
                SCHEDULE CALL
              </a>
            </ElectricBorder>
          </motion.div>
        </motion.div>
      </section>

      {/* Problem Section */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={staggerContainer}
        >
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-8">
            The Agency <span className="text-[#2196f3]">Challenge</span>
          </motion.h2>

          <div className="grid md:grid-cols-2 gap-12">
            <motion.div variants={slideInLeft} className="space-y-6">
              <h3 className="font-display text-2xl">Scaling Headcount = Scaling Costs</h3>
              <p className="text-[#5a5a5a] leading-relaxed">
                Every new client needs an SDR. Every SDR needs salary, training, and support. Your margins shrink as you grow. You're hitting the ceiling.
              </p>
              <ul className="space-y-3">
                {['Hiring bottleneck', 'High SDR turnover', 'Unpredictable quality'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <span className="text-[#2196f3]">✓</span>
                    <span className="text-[#5a5a5a]">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div variants={slideInRight} className="space-y-6">
              <h3 className="font-display text-2xl">Audnix Flips the Model</h3>
              <p className="text-[#5a5a5a] leading-relaxed">
                Deploy our white-label agents under your brand. Same closing power, zero hiring. Scale from 10 clients to 100 without adding payroll.
              </p>
              <ul className="space-y-3">
                {['Instant deployment', '70% margin per client', '24/7 availability'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3">
                    <Check className="w-4 h-4 text-[#2196f3]" />
                    <span className="text-[#5a5a5a]">{item}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* How It Works with ScrollStack */}
      <section className="relative border-t border-[#1e1e1e]">
        <div className="max-w-7xl mx-auto px-6 lg:px-12">
          <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="py-12">
            <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12">
              How It Works
            </motion.h2>
          </motion.div>
        </div>

        <ScrollStack className="h-screen bg-[#050505] border-b border-[#1e1e1e]" useWindowScroll={true} itemScale={0.04} baseScale={0.80}>
          <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
            <div className="flex items-center gap-6 h-full px-8">
              <div className="text-5xl"><Layers className="w-16 h-16 text-[#2196f3]" /></div>
              <div>
                <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Connect Your CRM</h3>
                <p className="text-[#5a5a5a]">Plug into Salesforce, HubSpot, Pipedrive. Your workflows stay intact.</p>
              </div>
            </div>
          </ScrollStackItem>

          <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
            <div className="flex items-center gap-6 h-full px-8">
              <div className="text-5xl"><Zap className="w-16 h-16 text-[#2196f3]" /></div>
              <div>
                <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Upload Playbooks</h3>
                <p className="text-[#5a5a5a]">AI learns your exact closing style in 48 hours. Battle cards and scripts included.</p>
              </div>
            </div>
          </ScrollStackItem>

          <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
            <div className="flex items-center gap-6 h-full px-8">
              <div className="text-5xl"><Check className="w-16 h-16 text-[#2196f3]" /></div>
              <div>
                <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">White-Label Deploy</h3>
                <p className="text-[#5a5a5a]">Agents run under your brand. Clients never know it's AI.</p>
              </div>
            </div>
          </ScrollStackItem>

          <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
            <div className="flex items-center gap-6 h-full px-8">
              <div className="text-5xl"><TrendingUp className="w-16 h-16 text-[#2196f3]" /></div>
              <div>
                <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Start Earning</h3>
                <p className="text-[#5a5a5a]">70% margins per client. Scale to 100+ without new hires.</p>
              </div>
            </div>
          </ScrollStackItem>

          <ScrollStackItem itemClassName="bg-[#0e0e0e] border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
            <div className="flex items-center gap-6 h-full px-8">
              <div className="text-5xl"><DollarSign className="w-16 h-16 text-[#2196f3]" /></div>
              <div>
                <h3 className="font-display text-3xl mb-2 text-[#f2ede6]">Exponential Growth</h3>
                <p className="text-[#5a5a5a]">Revenue scales infinitely. Linear costs. Your margins compound.</p>
              </div>
            </div>
          </ScrollStackItem>
        </ScrollStack>
      </section>

      {/* Metrics */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={staggerContainer}
        >
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12 text-center">
            Results from Partner <span className="text-[#2196f3]">Agencies</span>
          </motion.h2>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { value: "340%", label: "Avg Revenue Growth", sub: "Per Audnix Instance" },
              { value: "7", label: "Days", sub: "To First Deployment" },
              { value: "98%", label: "Client", sub: "Retention Rate" },
              { value: "$50K+", label: "Avg ARR", sub: "Per Instance" }
            ].map((metric, idx) => (
              <ScrollReveal key={idx}>
                <GlareHover className="text-center p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors rounded-lg">
                  <BlurText>
                    <div className="font-display text-5xl text-[#2196f3] mb-2">{metric.value}</div>
                    <div className="font-display text-lg mb-1">{metric.label}</div>
                    <div className="font-mono text-[10px] tracking-widest text-[#3a3a3a]">{metric.sub}</div>
                  </BlurText>
                </GlareHover>
              </ScrollReveal>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Comparison */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={staggerContainer}
          className="space-y-8"
        >
          <motion.h2 variants={fadeInUp} className="font-display text-5xl text-center">
            Audnix vs Hiring <span className="text-[#2196f3]">SDRs</span>
          </motion.h2>

          <motion.div variants={fadeInUp} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {[
                  { feature: 'Setup Time', audnix: '3 days', hiring: '30+ days' },
                  { feature: 'Cost Per Client', audnix: '$500/mo', hiring: '$5K+/mo' },
                  { feature: 'Quality Consistency', audnix: '100%', hiring: '60-80%' },
                  { feature: 'Availability', audnix: '24/7', hiring: '9-5' },
                  { feature: 'Scalability', audnix: 'Unlimited', hiring: 'Headcount limited' }
                ].map((row, idx) => (
                  <tr key={idx} className="border-b border-[#1e1e1e]">
                    <td className="py-4 pr-8 font-mono text-[#5a5a5a]">{row.feature}</td>
                    <td className="py-4 pr-8 text-[#2196f3]">{row.audnix}</td>
                    <td className="py-4 text-[#5a5a5a]">{row.hiring}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </motion.div>
      </section>

      {/* Premium Content Before CTA */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-16">
          <motion.div variants={bounceIn} className="grid md:grid-cols-3 gap-8">
            {[
              { title: 'Multi-Tenant Infrastructure', desc: 'Serve 100+ clients from a single AI deployment. Enterprise-grade security with complete data isolation per client.' },
              { title: 'White-Label Customization', desc: 'Your brand, your domain, your logo. Clients never know it\'s AI. Complete brand control with custom training on client playbooks.' },
              { title: 'Revenue Share Model', desc: 'Earn 70% of all AI revenue. Scale from 10 to 100 clients without hiring. Exponential growth, linear costs.' }
            ].map((item, i) => (
              <motion.div key={i} variants={flipIn} className="p-8 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors rounded-lg">
                <h3 className="font-display text-2xl text-[#2196f3] mb-3">{item.title}</h3>
                <p className="text-[#5a5a5a] leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          <motion.div variants={slideUp} className="grid md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <h3 className="font-display text-3xl">Why Agencies Choose Audnix</h3>
              <ul className="space-y-4">
                {[
                  'Instant deployment without custom engineering',
                  'Recurring revenue that scales exponentially',
                  'Zero hiring, training, or management overhead',
                  'Industry-leading AI accuracy and objection handling',
                  'Dedicated agency account manager for success',
                  'Proven playbook from 100+ agencies'
                ].map((item, i) => (
                  <motion.li key={i} variants={listItem} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-[#2196f3] flex-shrink-0 mt-1" />
                    <span className="text-[#5a5a5a]">{item}</span>
                  </motion.li>
                ))}
              </ul>
            </div>

            <motion.div variants={zoomIn} className="p-8 border border-[#2196f3]/20 bg-[#2196f3]/5 rounded-lg">
              <h4 className="font-display text-2xl text-[#2196f3] mb-4">Agency Success Story</h4>
              <p className="text-[#5a5a5a] mb-6 leading-relaxed">
                "Audnix took us from 8 clients to 60 in 6 months. Each client gets 24/7 AI sales reps under our brand. We went from $2M to $8M in revenue while actually reducing headcount."
              </p>
              <p className="font-mono text-[11px] tracking-widest text-[#3a3a3a]">— Sarah Chen, Founder, SalesScale Agency</p>
            </motion.div>
          </motion.div>

          <motion.div variants={rotateIn} className="bg-gradient-to-r from-[#2196f3]/10 to-transparent p-8 border border-[#2196f3]/20 rounded-lg">
            <h4 className="font-display text-2xl mb-4">Limited Time: Agency Partner Program</h4>
            <p className="text-[#5a5a5a] mb-4 leading-relaxed">
              Launch your first Audnix instance with 60% revenue share for 12 months. Includes dedicated onboarding, co-marketing, and priority support. Only 50 agency slots available.
            </p>
            <p className="font-mono text-[10px] text-[#3a3a3a]">Launch your first Audnix instance today and lock in premium partner rates</p>
          </motion.div>
        </motion.div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12 text-center">
            Agency <span className="text-[#2196f3]">Questions</span>
          </motion.h2>

          <div className="space-y-4">
            {[
              { q: 'How long until our clients see results?', a: 'Agencies typically deploy their first instance in 3-7 days. Client results appear within 14-21 days as the AI learns your playbooks and begins handling conversations.' },
              { q: 'Can we white-label completely?', a: 'Yes, 100% white-label. Your domain, your branding, your support line. Clients never know it\'s powered by Audnix. You keep the revenue and the relationship.' },
              { q: 'What\'s the revenue split?', a: 'Standard agency program: 60% first year, 50% after year one. Enterprise agencies on custom contracts can negotiate up to 70%+ based on volume commitments.' },
              { q: 'Does it work with our existing CRM?', a: 'Yes. Audnix integrates with Salesforce, HubSpot, Pipedrive, and 50+ other platforms. Integration takes 15 minutes with our pre-built connectors.' },
              { q: 'How do we get client support?', a: 'You get a dedicated Agency Success Manager. We also provide client onboarding templates, co-branded resources, and quarterly business reviews.' }
            ].map((faq, i) => (
              <motion.div key={i} variants={blurIn} className="border border-[#1e1e1e] rounded-lg overflow-hidden hover:border-[#2196f3]/40 transition-colors">
                <details className="group cursor-pointer">
                  <summary className="p-6 font-display text-lg flex items-center justify-between hover:bg-[#0a0a0a] transition-colors">
                    {faq.q}
                    <ChevronRight className="w-5 h-5 text-[#2196f3] group-open:rotate-90 transition-transform" />
                  </summary>
                  <motion.div variants={slideUp} className="px-6 pb-6 border-t border-[#1e1e1e] text-[#5a5a5a]">
                    {faq.a}
                  </motion.div>
                </details>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Final CTA */}
      <section className="py-20 px-6 lg:px-12 text-center border-t border-[#1e1e1e]">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl mx-auto"
        >
          <h2 className="font-display text-4xl mb-4">Stop Hiring. Start Scaling.</h2>
          <p className="text-[#5a5a5a] mb-8">
            Join agencies making $50K-$500K annually with Audnix.
          </p>
          <a
            href="/get-started"
            className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#42a5f5] transition-colors font-semibold"
          >
            GET STARTED FREE
            <ChevronRight className="w-4 h-4" />
          </a>
        </motion.div>
      </section>

      <FooterSection />
    </main>
  );
}
