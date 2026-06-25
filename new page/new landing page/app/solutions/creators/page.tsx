'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, ChevronDown } from 'lucide-react';
import { Navigation } from '@/components/landing/navigation';
import { FooterSection } from '@/components/landing/footer-section';
import { TypingText } from '@/components/animations/typing-text';

// 10 Different Animation Variants
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

export default function CreatorsPage() {
  const [active, setActive] = useState<number | null>(0);

  return (
    <main className="min-h-screen bg-[#050505] text-[#f2ede6]">
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

          <motion.p variants={fadeInUp} className="text-base text-[#d0ccc3] leading-relaxed max-w-2xl mx-auto mb-8">
            Send personalized cold emails at scale. AI writes, sends, and manages follow-ups automatically. Get qualified leads without touching a keyboard.
          </motion.p>

          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <a href="/signup" className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
              START FREE TRIAL <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a href="#" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
              LEARN MORE
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Problem */}
      <section className="py-16 md:py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-4xl md:text-5xl mb-8 md:mb-12">Cold Email Done <span className="text-[#2196f3]">Better</span></motion.h2>

          <div className="grid md:grid-cols-2 gap-8 md:gap-12">
            <motion.div variants={fadeInUp} className="space-y-6">
              <h3 className="font-display text-xl md:text-2xl">Manual Cold Email Doesn&apos;t Scale</h3>
              <p className="text-[#d0ccc3] text-sm md:text-base leading-relaxed">You&apos;re manually writing emails and tracking responses. 5-10 hours per week wasted. Low open rates. Forgetting follow-ups.</p>
              <ul className="space-y-3">
                {['Manual writing', 'Slow sequences', 'No personalization'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><span className="text-[#2196f3]">✗</span><span className="text-[#d0ccc3] text-sm md:text-base">{item}</span></li>
                ))}
              </ul>
            </motion.div>

            <motion.div variants={fadeInUp} className="space-y-6">
              <h3 className="font-display text-xl md:text-2xl">AI-Powered Cold Email</h3>
              <p className="text-[#d0ccc3] text-sm md:text-base leading-relaxed">Personalized emails at scale. Smart follow-ups. AI learns what works and optimizes every campaign automatically.</p>
              <ul className="space-y-3">
                {['Fully automated', 'Personalized at scale', '3x better response rates'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><Check className="w-4 h-4 text-[#2196f3]" /><span className="text-[#d0ccc3] text-sm md:text-base">{item}</span></li>
                ))}
              </ul>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="py-16 md:py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-8 md:space-y-12">
          <motion.h2 variants={fadeInUp} className="font-display text-4xl md:text-5xl">How It <span className="text-[#2196f3]">Works</span></motion.h2>

          {[
            { num: '01', title: 'Upload Your List', desc: 'CSV with email addresses. AI prepares personalization data in minutes.' },
            { num: '02', title: 'Set Your Campaign', desc: 'Define your offer, tone, and follow-up sequence. AI handles the rest.' },
            { num: '03', title: 'AI Sends & Tracks', desc: 'Personalized emails go out. Smart timing. Automatic follow-ups at the right moment.' },
            { num: '04', title: 'You Get Responses', desc: 'Qualified leads land in your inbox. Meetings ready to book.' }
          ].map((step, idx) => (
            <motion.div key={idx} variants={fadeInUp} className="flex gap-6 md:gap-8 items-start">
              <div className="flex-shrink-0 w-12 md:w-16"><div className="font-display text-2xl md:text-3xl text-[#2196f3]">{step.num}</div></div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display text-lg md:text-2xl mb-2">{step.title}</h3>
                <p className="text-[#d0ccc3] text-sm md:text-base leading-relaxed">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Results */}
      <section className="py-16 md:py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-4xl md:text-5xl mb-8 md:mb-12 text-center">Cold Email <span className="text-[#2196f3]">Results</span></motion.h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
            {[
              { value: '42%', label: 'Open Rate', sub: 'vs 25% average' },
              { value: '18%', label: 'Response Rate', sub: 'Highly qualified' },
              { value: '10h', label: 'Saved Weekly', sub: 'Your time back' },
              { value: '100x', label: 'More Outreach', sub: 'Per campaign' }
            ].map((metric, idx) => (
              <motion.div key={idx} variants={fadeInUp} className="text-center p-4 md:p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <div className="font-display text-3xl md:text-5xl text-[#2196f3] mb-1 md:mb-2">{metric.value}</div>
                <div className="font-display text-sm md:text-lg mb-1">{metric.label}</div>
                <div className="font-mono text-[9px] md:text-[10px] tracking-widest text-[#7a7a7a]">{metric.sub}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Email Platforms */}
      <section className="py-16 md:py-20 px-6 lg:px-12 max-w-7xl mx-auto border-b border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-8">
          <motion.h2 variants={fadeInUp} className="font-display text-4xl md:text-5xl">Works with All <span className="text-[#2196f3]">Email</span></motion.h2>
          <div className="grid md:grid-cols-2 gap-8">
            {['Gmail & Google Workspace', 'Outlook & Microsoft 365'].map((platform, i) => (
              <motion.div key={i} variants={fadeInUp} className="p-6 md:p-8 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors text-center">
                <h3 className="font-display text-xl md:text-2xl text-[#2196f3] mb-3">{platform}</h3>
                <p className="text-[#d0ccc3] text-sm md:text-base">Sends cold emails securely</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* FAQ Section */}
      <section className="relative border-b border-[#1e1e1e]">
        <div className="max-w-4xl mx-auto px-6 lg:px-12">
          <div className="border-b border-[#1e1e1e] py-8">
            <span className="sys-tag mb-3 block">FREQUENTLY ASKED</span>
            <h2 className="font-display text-5xl md:text-6xl leading-[0.88] tracking-tight text-[#f2ede6]">
              Cold Email<br />
              <span style={{ WebkitTextStroke: '1px #3a3a3a', color: 'transparent' }}>Questions</span>
            </h2>
          </div>

          <div className="divide-y divide-[#1e1e1e]">
            {[
              { q: 'Will emails end up in spam?', a: 'No. We use industry best practices for deliverability. Smart warmup sequences, proper SPF/DKIM setup, and natural sending patterns. 98%+ inbox placement.' },
              { q: 'How long before I see results?', a: 'First responses in 2-3 days. Full campaign momentum takes 1-2 weeks. Average 18% response rate within 30 days.' },
              { q: 'Can I customize the email templates?', a: 'Complete control. Write your own emails or use AI templates. Set tone, messaging, CTAs. We personalize based on your data.' },
              { q: 'What data do you need to personalize?', a: 'Company name, industry, and website are ideal. AI extracts additional insights. More data = better personalization = higher response rates.' },
              { q: 'Can I pause or stop campaigns?', a: 'Yes, anytime. Full control over scheduling, pausing, and recipient lists. View real-time analytics and adjust on the fly.' }
            ].map((faq, i) => (
              <div key={i} className="transition-all duration-500">
                <button
                  onClick={() => setActive(active === i ? null : i)}
                  className="w-full py-5 flex items-start justify-between gap-6 group hover:bg-[#0a0a0a] transition-colors"
                >
                  <span className="font-display text-lg md:text-xl leading-snug tracking-tight text-[#f2ede6] text-left">
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
                    <p className="font-mono text-xs md:text-sm text-[#d0ccc3] leading-relaxed max-w-3xl">
                      {faq.a}
                    </p>
                  </motion.div>
                )}
              </div>
            ))}
          </div>

          <p className="py-8 text-center font-mono text-[10px] text-[#7a7a7a]">
            Need more help? <a href="#" className="text-[#2196f3] hover:text-[#60a5fa] transition-colors">Contact our team</a>
          </p>
        </div>
      </section>

      {/* CTA Section Before Footer */}
      <section className="py-16 md:py-24 px-6 lg:px-12 text-center border-b border-[#1e1e1e]">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-2xl mx-auto">
          <h2 className="font-display text-4xl md:text-5xl mb-4 md:mb-6">Scale Cold Email Today</h2>
          <p className="text-[#d0ccc3] mb-8 text-sm md:text-base">Send personalized emails to 1000s of prospects. Get qualified responses automatically.</p>
          <a href="/signup" className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 md:px-8 py-3 md:py-4 hover:bg-[#60a5fa] transition-colors font-semibold">
            START FREE TRIAL <ChevronRight className="w-4 h-4" />
          </a>
        </motion.div>
      </section>

      <FooterSection />
    </main>
  );
}
