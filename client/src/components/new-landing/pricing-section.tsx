import { useState, useEffect, useRef } from "react";

const PLANS = [
  {
    id: "01",
    name: "ACCELERATOR TRIAL",
    tagline: "3-day free trial",
    price: { mo: 0, yr: 0 },
    features: [
      "10,000 lead sync",
      "2 Connected Mailboxes",
      "100 AI Voice Minutes",
      "Basic Cadence",
      "Standard Support",
    ],
    cta: "START FREE TRIAL",
    highlight: false,
  },
  {
    id: "02",
    name: "GROWTH",
    tagline: "Scale your pipeline",
    price: { mo: 49, yr: 39 },
    features: [
      "2,500 leads / month",
      "5 Connected Mailboxes",
      "250 AI Voice Minutes",
      "Autonomous Follow-ups",
      "Smart CRM Integration",
      "Performance Analytics",
      "Conversion Tracking",
    ],
    cta: "START TRIAL",
    highlight: false,
  },
  {
    id: "03",
    name: "PERFORMANCE",
    tagline: "Enterprise-grade closing",
    price: { mo: 99, yr: 79 },
    features: [
      "7,000 leads / month",
      "15 Connected Mailboxes",
      "1,000 AI Voice Minutes",
      "Deep Lead Insights",
      "Intent Recognition",
      "110+ Objection Mastery",
      "Strategic ROI Mapping",
      "Priority Support",
    ],
    cta: "START TRIAL",
    highlight: true,
  },
  {
    id: "04",
    name: "ENTERPRISE",
    tagline: "Custom scaling",
    price: { mo: null, yr: null },
    features: [
      "Unlimited leads",
      "Unlimited Mailboxes",
      "Unlimited Voice Minutes",
      "Voice Cloning & Training",
      "Smart Auto-Tagging",
      "Drop-off & Churn Detection",
      "Dedicated Success Manager",
      "24/7 Priority Support",
    ],
    cta: "CONTACT SALES",
    highlight: false,
  },
];

export function PricingSection() {
  const [annual, setAnnual] = useState(true);
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="pricing" ref={ref} className="relative border-t border-[#1e1e1e] bg-[#080808] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Header */}
        <div
          className={`border-b border-[#1e1e1e] py-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 transition-all duration-500 ${vis ? "opacity-100" : "opacity-0"}`}
        >
          <div>
            <span className="sys-tag mb-3 block">PRICING</span>
            <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
              INVEST IN<br />
              <span style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>REVENUE</span>
            </h2>
          </div>

          {/* Billing toggle */}
          <div className="flex items-center gap-4">
            <span className={`font-mono text-[11px] tracking-widest transition-colors ${!annual ? "text-[#f2ede6]" : "text-[#7a7a7a]"}`}>MONTHLY</span>
            <button
              onClick={() => setAnnual(!annual)}
              className="relative w-12 h-6 bg-[#1e1e1e] border border-[#2e2e2e] flex items-center"
            >
              <div className={`w-4 h-4 bg-[#2196f3] transition-transform duration-300 mx-1 ${annual ? "translate-x-5" : "translate-x-0"}`} />
            </button>
            <span className={`font-mono text-[11px] tracking-widest transition-colors ${annual ? "text-[#f2ede6]" : "text-[#7a7a7a]"}`}>ANNUAL</span>
            {annual && (
              <span className="font-mono text-[9px] tracking-widest border border-[#2196f3]/40 text-[#2196f3] px-2 py-1">
                SAVE_20%
              </span>
            )}
          </div>
        </div>

        {/* Plans grid */}
        <div className="border-b border-[#1e1e1e]">
          <div className="grid md:grid-cols-3 border-b border-[#1e1e1e]">
          {PLANS.slice(0, 3).map((p, i) => (
            <div
              key={p.id}
              className={`border-r border-[#1e1e1e] last:border-r-0 relative transition-all duration-500 ${
                p.highlight ? "bg-[#0e0e0e]" : ""
              } ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              {p.highlight && (
                <div className="absolute top-0 left-0 right-0 h-px bg-[#2196f3]" />
              )}

              <div className="p-8 border-b border-[#1e1e1e]">
                <div className="flex items-start justify-between mb-4">
                  <span className="font-mono text-[9px] text-[#a0a0a0]">{p.id}</span>
                  {p.highlight && (
                    <span className="font-mono text-[9px] tracking-widest border border-[#2196f3]/40 text-[#2196f3] px-2 py-1">
                      POPULAR
                    </span>
                  )}
                </div>
                <h3 className="font-display text-4xl text-[#f2ede6] mb-1">{p.name}</h3>
                <p className="font-mono text-[10px] text-[#8a8a8a] tracking-wider">{p.tagline}</p>
              </div>

              <div className="p-8 border-b border-[#1e1e1e]">
                {p.price.mo !== null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-6xl text-[#f2ede6]">
                      ${annual ? p.price.yr : p.price.mo}
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a]">/MONTH</span>
                  </div>
                ) : (
                  <span className="font-display text-5xl text-[#f2ede6]">CUSTOM</span>
                )}
              </div>

              <ul className="p-8 space-y-3 border-b border-[#1e1e1e]">
                {p.features.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="text-[#2196f3] font-mono text-[10px] mt-0.5 shrink-0">+</span>
                    <span className="font-mono text-[11px] text-[#8a8a8a]">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="p-8">
                <a
                  href={p.cta === "CONTACT SALES" ? "mailto:hello@audnixai.com" : "/signup"}
                  className={`w-full flex items-center justify-between font-mono text-[11px] tracking-widest px-5 py-4 transition-colors group ${
                    p.highlight
                      ? "bg-[#2196f3] text-[#050505] hover:bg-[#fbbf24] font-semibold"
                      : "border border-[#2e2e2e] text-[#a0a0a0] hover:border-[#2196f3]/40 hover:text-[#2196f3]"
                  }`}
                >
                  {p.cta}
                  <span className="transition-transform group-hover:translate-x-1">→</span>
                </a>
              </div>
            </div>
          ))}
          </div>

          {/* Enterprise plan - full width */}
          {PLANS.slice(3).map((p, i) => (
            <div
              key={p.id}
              className={`relative transition-all duration-500 ${
                vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
              style={{ transitionDelay: `${(i + 3) * 80}ms` }}
            >
              <div className="p-8 border-b border-[#1e1e1e]">
                <div className="flex items-start justify-between mb-4">
                  <span className="font-mono text-[9px] text-[#a0a0a0]">{p.id}</span>
                </div>
                <h3 className="font-display text-4xl text-[#f2ede6] mb-1">{p.name}</h3>
                <p className="font-mono text-[10px] text-[#8a8a8a] tracking-wider">{p.tagline}</p>
              </div>

              <div className="p-8 border-b border-[#1e1e1e]">
                {p.price.mo !== null ? (
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-6xl text-[#f2ede6]">
                      ${annual ? p.price.yr : p.price.mo}
                    </span>
                    <span className="font-mono text-[10px] text-[#8a8a8a]">/MONTH</span>
                  </div>
                ) : (
                  <span className="font-display text-5xl text-[#f2ede6]">CUSTOM</span>
                )}
              </div>

              <ul className="p-8 space-y-3 border-b border-[#1e1e1e]">
                {p.features.map(f => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="text-[#2196f3] font-mono text-[10px] mt-0.5 shrink-0">+</span>
                    <span className="font-mono text-[11px] text-[#8a8a8a]">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="p-8">
                <a
                  href={p.cta === "CONTACT SALES" ? "mailto:hello@audnixai.com" : "/signup"}
                  className="w-full flex items-center justify-between font-mono text-[11px] tracking-widest px-5 py-4 transition-colors border border-[#2e2e2e] text-[#a0a0a0] hover:border-[#2196f3]/40 hover:text-[#2196f3]"
                >
                  {p.cta}
                  <span className="group-hover:translate-x-1 transition-transform">→</span>
                </a>
              </div>
            </div>
          ))}
        </div>

        <p className="py-5 text-center font-mono text-[10px] text-[#6a9aaa]">
          CANCEL ANYTIME · NO LONG-TERM CONTRACTS · 3-DAY FREE TRIAL
        </p>
      </div>
    </section>
  );
}
