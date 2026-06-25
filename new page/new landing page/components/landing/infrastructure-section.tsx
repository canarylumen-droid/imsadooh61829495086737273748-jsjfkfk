"use client";

import { useEffect, useRef, useState } from "react";

const REGIONS = [
  { city: "US Morning Peak", timezone: "EST 9-11am",      openRate: "52%", clickRate: "18%", delivery: 99.8 },
  { city: "US Mid-day",      timezone: "EST 2-4pm",       openRate: "44%", clickRate: "14%", delivery: 99.9 },
  { city: "UK Business Hours", timezone: "GMT 10am-12pm", openRate: "48%", clickRate: "16%", delivery: 99.7 },
  { city: "EU Workday",      timezone: "CET 9am-11am",    openRate: "46%", clickRate: "15%", delivery: 99.6 },
  { city: "APAC Early Morning", timezone: "SGT 6-8am",    openRate: "38%", clickRate: "11%", delivery: 99.5 },
  { city: "Global Send",     timezone: "24/7 Schedule",   openRate: "42%", clickRate: "13%", delivery: 99.9 },
];

export function InfrastructureSection() {
  const [vis, setVis]       = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setActive(a => (a + 1) % REGIONS.length), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <section id="infrastructure" ref={ref} className="relative border-t border-[#1e1e1e] bg-[#080808] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Header */}
        <div
          className={`border-b border-[#1e1e1e] py-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 transition-all duration-500 ${vis ? "opacity-100" : "opacity-0"}`}
        >
          <div>
            <span className="sys-tag mb-3 block">PREDICTIVE TIMING</span>
            <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
              OPTIMAL<br />
              <span style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>SEND TIMES</span>
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-8 text-right">
            {[
              { v: "52%",   l: "MAX OPEN RATE" },
              { v: "99.9%", l: "EMAIL DELIVERY" },
              { v: "18%",   l: "AVG CLICK RATE" },
            ].map(s => (
              <div key={s.l}>
                <div className="font-display text-3xl text-[#2196f3]">{s.v}</div>
                <div className="font-mono text-[9px] text-[#7a7a7a] tracking-widest mt-1">{s.l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Send times table */}
        <div className="border-b border-[#1e1e1e]">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_120px_100px_100px_140px] border-b border-[#1e1e1e] px-6 py-3">
            {["TIME WINDOW", "TIMEZONE", "OPEN RATE", "CLICK RATE", "DELIVERY"].map(h => (
              <span key={h} className="font-mono text-[9px] text-[#7a7a7a] tracking-widest">{h}</span>
            ))}
          </div>

          {/* Rows */}
          {REGIONS.map((r, i) => (
            <div
              key={r.city}
              className={`grid grid-cols-[1fr_120px_100px_100px_140px] px-6 py-5 border-b border-[#1e1e1e] last:border-b-0 transition-all duration-300 ${
                active === i ? "bg-[#0e0e0e]" : "hover:bg-[#0a0a0a]"
              } ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${
                    active === i ? "bg-[#22c55e]" : "bg-[#2e2e2e]"
                  }`}
                />
                <span className={`font-mono text-sm ${active === i ? "text-[#f2ede6]" : "text-[#9a9a9a]"}`}>
                  {r.city}
                </span>
              </div>
              <span className="font-mono text-[10px] text-[#7a7a7a] tracking-wider self-center">{r.timezone}</span>
              <span className={`font-mono text-sm font-bold self-center ${active === i ? "text-[#22c55e]" : "text-[#9a9a9a]"}`}>
                {r.openRate}
              </span>
              <span className="font-mono text-sm text-[#9a9a9a] self-center">{r.clickRate}</span>
              {/* Delivery bar */}
              <div className="flex items-center gap-2 self-center">
                <div className="flex-1 h-1 bg-[#1e1e1e]">
                  <div
                    className="h-full bg-[#22c55e] transition-all duration-500"
                    style={{ width: `${r.delivery}%`, opacity: active === i ? 1 : 0.5 }}
                  />
                </div>
                <span className="font-mono text-[10px] text-[#7a7a7a] w-10 text-right">{r.delivery}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="py-4 flex justify-end">
          <span className="font-mono text-[10px] text-[#7a7a7a]">
            AI OPTIMIZES SEND TIMES · REAL-TIME BASED ON RECIPIENT DATA &nbsp;· &nbsp;99.9%+ DELIVERY
          </span>
        </div>
      </div>
    </section>
  );
}
