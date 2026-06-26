import { useEffect, useRef, useState } from "react";

function AnimCounter({
  end,
  suffix = "",
  prefix = "",
}: {
  end: number;
  suffix?: string;
  prefix?: string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !done.current) {
          done.current = true;
          const start = performance.now();
          const dur = 1800;
          const tick = (now: number) => {
            const p = Math.min((now - start) / dur, 1);
            const ease = 1 - Math.pow(1 - p, 3);
            setN(Math.floor(ease * end));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [end]);

  return (
    <div
      ref={ref}
      className="font-display text-4xl text-[#2196f3] tabular-nums"
    >
      {prefix}
      {n.toLocaleString()}
      {suffix}
    </div>
  );
}

const FEATURES = [
  {
    id: "01",
    tag: "INTELLIGENCE",
    title: "VOICE NOTE\nINTELLIGENCE",
    desc: "Acoustic modeling extracts intent, urgency, and emotional state from voice notes. Your AI knows when someone is ready to buy, hesitant, or disqualified.",
    stat: { end: 110, suffix: "+", l: "objection scripts" },
  },
  {
    id: "02",
    tag: "ENGAGEMENT",
    title: "PREDICTIVE\nTIMING",
    desc: "ML-driven timing optimization. Don't just respond faster — respond at the exact moment your prospect is most likely to engage. 70% of deals go to the fastest responder.",
    stat: { end: 70, suffix: "%", l: "faster than humans" },
  },
  {
    id: "03",
    tag: "ORCHESTRATION",
    title: "MULTI-CHANNEL\nSCALE",
    desc: "Email, LinkedIn, voice, SMS — one autonomous engine orchestrates all channels. Coordinates cadences, prevents contact fatigue, and adapts to channel preferences.",
    stat: { end: 10, suffix: "K+", l: "leads in parallel" },
  },
  {
    id: "04",
    tag: "AUTOMATION",
    title: "DETERMINISTIC\nCLOSING",
    desc: "Proprietary behavioral models train on your exact closing playbook. Not templated responses — real, personalized objection handling that mirrors your top closer's logic.",
    stat: { end: 98, suffix: "%", l: "delivery rate" },
  },
];

function FeatureRow({ f, index }: { f: typeof FEATURES[0]; index: number }) {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.15 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`group border-b border-[#1e1e1e] transition-all duration-500 row-hover ${
        vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
      style={{ transitionDelay: `${index * 80}ms` }}
    >
      <div className="grid grid-cols-[56px_1fr] lg:grid-cols-[56px_260px_1fr_160px] gap-0">
        {/* Number col */}
        <div className="border-r border-[#1e1e1e] p-5 flex items-start pt-6">
          <span className="font-mono text-[10px] text-[#7a7a7a] tracking-widest">{f.id}</span>
        </div>

        {/* Tag + Title */}
        <div className="border-r border-[#1e1e1e] p-6 flex flex-col gap-3">
          <span className="sys-tag text-[9px]">{f.tag}</span>
          <h3 className="font-display text-3xl lg:text-4xl leading-[0.9] text-[#f2ede6] group-hover:text-[#2196f3] transition-colors duration-300 whitespace-pre-line">
            {f.title}
          </h3>
        </div>

        {/* Description */}
        <div className="col-span-2 lg:col-span-1 border-r border-[#1e1e1e] p-6 flex items-center">
          <p className="text-sm text-[#a0a0a0] leading-relaxed max-w-lg">{f.desc}</p>
        </div>

        {/* Stat */}
        <div className="hidden lg:flex flex-col items-end justify-center p-6">
          <AnimCounter end={f.stat.end} suffix={f.stat.suffix} />
          <div className="font-mono text-[9px] text-[#7a7a7a] tracking-widest mt-1 text-right">{f.stat.l}</div>
        </div>
      </div>
    </div>
  );
}

export function FeaturesSection() {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.05 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="features" className="relative border-t border-[#1e1e1e] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Section header row */}
        <div
          ref={ref}
          className={`grid grid-cols-[56px_1fr] lg:grid-cols-[56px_260px_1fr_160px] border-b border-[#1e1e1e] transition-all duration-500 ${
            vis ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="border-r border-[#1e1e1e] p-5" />
          <div className="col-span-2 lg:col-span-3 p-6 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="sys-tag mb-4 block">CAPABILITIES</span>
              <h2 className="font-display text-6xl lg:text-8xl text-[#f2ede6] leading-[0.88] tracking-tight">
                WHAT AUDNIX<br />
                <span className="text-[#7a7a7a]" style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>
                  CAN DO
                </span>
              </h2>
            </div>
            <p className="font-mono text-[10px] text-[#7a7a7a] tracking-widest max-w-[200px] text-right hidden lg:block">
              FOUR CORE MODULES &nbsp;/ &nbsp;ENTERPRISE-GRADE &nbsp;/ &nbsp;PRODUCTION-READY
            </p>
          </div>
        </div>

        {/* Feature rows */}
        {FEATURES.map((f, i) => (
          <FeatureRow key={f.id} f={f} index={i} />
        ))}

        {/* CTA row */}
        <div className="grid grid-cols-[56px_1fr] border-b border-[#1e1e1e]">
          <div className="border-r border-[#1e1e1e]" />
          <div className="p-6 flex items-center justify-between">
            <span className="font-mono text-[10px] text-[#7a7a7a]">VIEW ALL CAPABILITIES IN DOCS →</span>
            <a href="#" className="font-mono text-xs text-[#2196f3] hover:underline tracking-wider">EXPLORE SDK</a>
          </div>
        </div>
      </div>
    </section>
  );
}
