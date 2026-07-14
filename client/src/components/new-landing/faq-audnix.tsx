import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQS = [
  {
    q: "How does Audnix qualify leads?",
    a: "Audnix uses voice intelligence and acoustic modeling to analyze prospect intent, urgency, and objection patterns. It scores leads in real-time and only books qualified meetings.",
  },
  {
    q: "Can I customize the sales playbook?",
    a: "Absolutely. Upload your pitch deck, battle cards, and objection scripts. Audnix learns your exact closing logic and applies it across all conversations.",
  },
  {
    q: "What's the integration setup time?",
    a: "Typical CRM integration (Salesforce, HubSpot, Pipedrive) takes 15 minutes. We provide pre-built connectors for all major platforms.",
  },
  {
    q: "How many leads can Audnix handle monthly?",
    a: "Depends on your plan. Growth handles 2.5K/month, Performance handles 7K/month, Enterprise scales to unlimited. All with 97% delivery rate.",
  },
  {
    q: "Does it handle objections in real-time?",
    a: "Yes. Audnix identifies objections from voice notes, searches your playbook for matching scripts, and responds with personalized rebuttals—all within minutes.",
  },
  {
    q: "What's your refund policy?",
    a: "We offer a 30-day money-back guarantee. If you don't see ROI within your first month, we refund 100%. No questions asked.",
  },
];

export function FAQSection() {
  const [active, setActive] = useState<number | null>(0);
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
    <section ref={ref} id="faq" className="relative border-t border-[#1e1e1e] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Header */}
        <div
          className={`border-b border-[#1e1e1e] py-8 transition-all duration-500 ${
            vis ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-end justify-between mb-6">
            <div>
              <span className="sys-tag mb-3 block">FAQ</span>
              <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
                QUESTIONS
                <br />
                <span
                  style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}
                >
                  ANSWERED
                </span>
              </h2>
            </div>
          </div>
        </div>

        {/* FAQ list */}
        <div className="divide-y divide-[#1e1e1e]">
          {FAQS.map((faq, i) => (
            <div
              key={i}
              className={`transition-all duration-500 ${
                vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
              style={{ transitionDelay: `${i * 50}ms` }}
            >
              <button
                onClick={() => setActive(active === i ? null : i)}
                className="w-full py-6 flex items-start justify-between gap-6 group hover:bg-[#0a0a0a] transition-colors"
              >
                <span className="font-display text-xl lg:text-2xl leading-tight tracking-tight text-[#f2ede6] text-left">
                  {faq.q}
                </span>
                <ChevronDown
                  className={`w-5 h-5 text-[#2196f3] flex-shrink-0 mt-1 transition-transform duration-300 ${
                    active === i ? "rotate-180" : ""
                  }`}
                />
              </button>

              {active === i && (
                <div className="pb-6 border-t border-[#1e1e1e] pt-4 animate-in fade-in duration-200">
                  <p className="font-mono text-sm text-[#a0a0a0] leading-relaxed max-w-2xl">
                    {faq.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-[#1e1e1e] py-12 text-center">
          <p className="font-mono text-[11px] text-[#7a7a7a] tracking-widest uppercase mb-4">
            Still have questions?
          </p>
          <a
            href="mailto:hello@audnixai.com"
            className="group inline-flex items-center gap-3 text-[#2196f3] font-mono text-sm tracking-widest hover:text-[#42a5f5] transition-colors"
          >
            CONTACT OUR TEAM
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </a>
        </div>

      </div>
    </section>
  );
}
