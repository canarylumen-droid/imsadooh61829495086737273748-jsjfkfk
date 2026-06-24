import { motion } from "framer-motion";
import { ChevronRight, Check, Zap, Layers, TrendingUp, DollarSign } from "lucide-react";
import { Navigation } from "@/components/landing/Navigation";
import { CookieConsent } from "@/components/landing/CookieConsent";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useEffect } from "react";

const fadeInUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };
const slideInLeft = { initial: { opacity: 0, x: -40 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.6 } };
const slideInRight = { initial: { opacity: 0, x: 40 }, animate: { opacity: 1, x: 0 }, transition: { duration: 0.6 } };
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

export default function AgenciesPage() {
  useSEO(
    "For Agencies - Audnix AI | White-Label AI Sales Agents",
    "White-label AI agents for agencies. Scale from 10 to 100 clients without hiring. 70% margins. Your brand, our AI. Join agencies making $50K-$500K annually."
  );

  return (
    <main className="min-h-screen bg-background text-[#f2ede6] overflow-x-hidden">
      <Navigation />

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-20 overflow-hidden">
        <motion.div initial="initial" animate="animate" variants={staggerContainer} className="max-w-4xl mx-auto text-center">
          <motion.div variants={slideInLeft}>
            <span className="font-mono text-[11px] tracking-[0.2em] text-[#2196f3] uppercase">FOR AGENCIES & RESELLERS</span>
          </motion.div>
          <motion.h1 variants={slideInRight} className="font-display text-[clamp(3rem,10vw,6rem)] leading-[0.88] tracking-tight mt-4 mb-6">
            Scale Without<br />
            <span className="text-[#2196f3]">Headcount</span>
          </motion.h1>
          <motion.div variants={fadeInUp} className="mb-8">
            <p className="text-base text-[#5a5a5a] leading-relaxed max-w-2xl mx-auto">
              White-label AI agents that close deals under your brand. Add revenue without adding overhead. Your clients get results, you keep the margins.
            </p>
          </motion.div>
          <motion.div variants={fadeInUp} className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/auth">
              <Button className="group inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-6 py-4 hover:bg-[#42a5f5] transition-colors font-semibold h-auto rounded-none">
                START FREE TRIAL
                <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <a href="#" className="group inline-flex items-center gap-3 border border-[#1e1e1e] text-[#f2ede6] font-mono text-sm tracking-widest px-6 py-4 hover:border-[#2196f3]/40 transition-colors">
              SCHEDULE CALL
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Problem Section */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-8">
            The Agency <span className="text-[#2196f3]">Challenge</span>
          </motion.h2>
          <div className="grid md:grid-cols-2 gap-12">
            <motion.div variants={slideInLeft} className="space-y-6">
              <h3 className="font-display text-2xl">Scaling Headcount = Scaling Costs</h3>
              <p className="text-[#5a5a5a] leading-relaxed">Every new client needs an SDR. Every SDR needs salary, training, and support. Your margins shrink as you grow.</p>
              <ul className="space-y-3">
                {["Hiring bottleneck", "High SDR turnover", "Unpredictable quality"].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><span className="text-[#2196f3]">\u2713</span><span className="text-[#5a5a5a]">{item}</span></li>
                ))}
              </ul>
            </motion.div>
            <motion.div variants={slideInRight} className="space-y-6">
              <h3 className="font-display text-2xl">Audnix Flips the Model</h3>
              <p className="text-[#5a5a5a] leading-relaxed">Deploy our white-label agents under your brand. Same closing power, zero hiring. Scale from 10 clients to 100 without adding payroll.</p>
              <ul className="space-y-3">
                {["Instant deployment", "70% margin per client", "24/7 availability"].map((item, i) => (
                  <li key={i} className="flex items-center gap-3"><Check className="w-4 h-4 text-[#2196f3]" /><span className="text-[#5a5a5a]">{item}</span></li>
                ))}
              </ul>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
          <motion.h2 variants={fadeInUp} className="font-display text-5xl mb-12">How It Works</motion.h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Layers, title: "Connect Your CRM", desc: "Plug into Salesforce, HubSpot, Pipedrive. Your workflows stay intact." },
              { icon: Zap, title: "Upload Playbooks", desc: "AI learns your exact closing style in 48 hours. Battle cards and scripts included." },
              { icon: Check, title: "White-Label Deploy", desc: "Agents run under your brand. Clients never know it's AI." },
              { icon: TrendingUp, title: "Start Earning", desc: "70% margins per client. Scale to 100+ without new hires." },
              { icon: DollarSign, title: "Exponential Growth", desc: "Revenue scales infinitely. Linear costs. Your margins compound." }
            ].map((item, i) => (
              <motion.div key={i} variants={fadeInUp} className="p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <item.icon className="w-10 h-10 text-[#2196f3] mb-4" />
                <h3 className="font-display text-xl mb-2">{item.title}</h3>
                <p className="text-[#5a5a5a] text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Metrics */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer}>
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
              <motion.div key={idx} variants={fadeInUp} className="text-center p-6 border border-[#1e1e1e] hover:border-[#2196f3]/40 transition-colors">
                <div className="font-display text-5xl text-[#2196f3] mb-2">{metric.value}</div>
                <div className="font-display text-lg mb-1">{metric.label}</div>
                <div className="font-mono text-[10px] tracking-widest text-[#3a3a3a]">{metric.sub}</div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Comparison */}
      <section className="py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-[#1e1e1e]">
        <motion.div initial="initial" whileInView="animate" viewport={{ once: true }} variants={staggerContainer} className="space-y-8">
          <motion.h2 variants={fadeInUp} className="font-display text-5xl text-center">
            Audnix vs Hiring <span className="text-[#2196f3]">SDRs</span>
          </motion.h2>
          <motion.div variants={fadeInUp} className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {[
                  { feature: "Setup Time", audnix: "3 days", hiring: "30+ days" },
                  { feature: "Cost Per Client", audnix: "$500/mo", hiring: "$5K+/mo" },
                  { feature: "Quality Consistency", audnix: "100%", hiring: "60-80%" },
                  { feature: "Availability", audnix: "24/7", hiring: "9-5" },
                  { feature: "Scalability", audnix: "Unlimited", hiring: "Headcount limited" }
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

      {/* CTA */}
      <section className="py-20 px-6 lg:px-12 text-center border-t border-[#1e1e1e]">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="max-w-2xl mx-auto">
          <h2 className="font-display text-4xl mb-4">Stop Hiring. Start Scaling.</h2>
          <p className="text-[#5a5a5a] mb-8">Join agencies making $50K-$500K annually with Audnix.</p>
          <Link href="/auth">
            <Button className="inline-flex items-center gap-3 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-4 hover:bg-[#42a5f5] transition-colors font-semibold h-auto rounded-none">
              GET STARTED FREE
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* JSON-LD */}
      <script type="application/ld+json">
        {JSON.stringify({ "@context": "https://schema.org", "@type": "Service", "name": "White-Label AI Agents for Agencies", "provider": { "@type": "Organization", "name": "Audnix AI" }, "description": "White-label AI sales agents that agencies can resell under their own brand. 70% margins, instant deployment, enterprise-grade infrastructure." })}
      </script>
      <section className="sr-only opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
        <h2>Agency AI Sales & White Label Keywords</h2>
        <p>
          white label ai sales, agency ai agents, resell ai sales, agency growth platform, ai for digital agencies,
          white label sdr, agency automation, scale agency without hiring, ai sales for agencies, agency revenue model,
          resell ai software, agency partnership program, audnix ai, nleanya treasure, uchendu fortune,
          alternative to instantly, alternative to smartlead, ai sales agent platform, b2b lead generation for agencies
        </p>
      </section>
      <CookieConsent />
    </main>
  );
}
