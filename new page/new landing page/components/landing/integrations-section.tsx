"use client";

import { useEffect, useRef, useState } from "react";

const ROW1 = [
  { name: "Gmail",       cat: "EMAIL" },
  { name: "Outlook",     cat: "EMAIL" },
  { name: "Custom Email", cat: "EMAIL" },
  { name: "Google Calendar", cat: "CALENDAR" },
  { name: "Calendly",    cat: "SCHEDULING" },
  { name: "HubSpot",     cat: "CRM" },
  { name: "Salesforce",  cat: "CRM" },
  { name: "LinkedIn",    cat: "OUTREACH" },
  { name: "Slack",       cat: "NOTIFICATIONS" },
  { name: "Zapier",      cat: "AUTOMATION" },
];

const ROW2 = [
  { name: "Microsoft 365", cat: "WORKSPACE" },
  { name: "Google Workspace", cat: "WORKSPACE" },
  { name: "Apollo.io",   cat: "DATA" },
  { name: "Hunter.io",   cat: "DATA" },
  { name: "Clearbit",    cat: "DATA" },
  { name: "Stripe",      cat: "PAYMENTS" },
  { name: "Mixpanel",    cat: "ANALYTICS" },
  { name: "Segment",     cat: "DATA PIPELINE" },
  { name: "Make",        cat: "AUTOMATION" },
  { name: "Webhook",     cat: "CUSTOM" },
];

function IntChip({ name, cat }: { name: string; cat: string }) {
  return (
    <div className="shrink-0 flex items-center gap-4 border border-[#1e1e1e] px-5 py-3.5 hover:border-[#2196f3]/40 hover:bg-[#2196f3]/5 transition-all duration-200 cursor-default group">
      <span className="font-mono text-[9px] text-[#7a7a7a] tracking-widest">{cat}</span>
      <span className="font-display text-lg text-[#9a9a9a] group-hover:text-[#f2ede6] transition-colors">
        {name}
      </span>
    </div>
  );
}

export function IntegrationsSection() {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="integrations" className="relative border-t border-[#1e1e1e] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div
          ref={ref}
          className={`border-b border-[#1e1e1e] py-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 transition-all duration-500 ${vis ? "opacity-100" : "opacity-0"}`}
        >
          <div>
            <span className="sys-tag mb-3 block">INTEGRATIONS</span>
            <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
              YOUR TOOLS.<br />
              <span style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>FULLY CONNECTED.</span>
            </h2>
          </div>
          <p className="font-mono text-[10px] text-[#7a7a7a] max-w-[220px] text-right hidden lg:block leading-relaxed">
            20+ INTEGRATIONS &nbsp;/&nbsp; EMAIL, CALENDAR, CRM, DATA, AUTOMATION
          </p>
        </div>
      </div>

      {/* Marquee rows — full width */}
      <div className="border-b border-[#1e1e1e] py-4 overflow-hidden">
        <div className="flex gap-3 marquee">
          {[...Array(2)].map((_, ri) => (
            <div key={ri} className="flex gap-3 shrink-0">
              {ROW1.map(i => <IntChip key={`${i.name}-${ri}`} {...i} />)}
            </div>
          ))}
        </div>
      </div>

      <div className="border-b border-[#1e1e1e] py-4 overflow-hidden">
        <div className="flex gap-3" style={{ animation: "marquee 20s linear infinite reverse" }}>
          {[...Array(2)].map((_, ri) => (
            <div key={ri} className="flex gap-3 shrink-0">
              {ROW2.map(i => <IntChip key={`${i.name}-${ri}`} {...i} />)}
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 lg:px-12 py-5 flex items-center justify-between">
        <span className="font-mono text-[10px] text-[#7a7a7a]">CONNECT YOUR EMAIL, CALENDAR, AND CRM</span>
        <a href="#" className="font-mono text-[10px] text-[#2196f3] hover:underline tracking-wider">
          VIEW ALL INTEGRATIONS →
        </a>
      </div>
    </section>
  );
}
