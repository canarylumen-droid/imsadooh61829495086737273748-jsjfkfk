import { useEffect, useRef, useState } from "react";

function AnimCounter({
  end,
  suffix = "",
  prefix = "",
  isVisible,
  speed = "normal",
  format,
}: {
  end: number;
  suffix?: string;
  prefix?: string;
  isVisible: boolean;
  speed?: "fast" | "normal" | "slow";
  format?: (n: number) => string;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isVisible) {
      setN(0);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      return;
    }

    const start = performance.now();
    // Speed mapping: fast (600ms), normal (1800ms), slow (3000ms)
    const dur = speed === "fast" ? 600 : speed === "slow" ? 3000 : 1800;
    
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setN(Math.floor(ease * end));
      if (p < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };
    
    animFrameRef.current = requestAnimationFrame(tick);
    
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [end, isVisible, speed]);

  const displayValue = format ? format(n) : `${n.toLocaleString()}${suffix}`;

  return (
    <div
      ref={ref}
      className="font-display text-[clamp(2rem,5vw,4rem)] leading-none tracking-tight text-[#f2ede6] tabular-nums"
    >
      {prefix}
      {displayValue}
    </div>
  );
}

// Each day: 0 = healthy, 1 = degraded, 2 = incident
const UPTIME_DATA: number[] = (() => {
  const d: number[] = [];
  for (let i = 0; i < 90; i++) {
    if (i === 14 || i === 51) d.push(2);      // incident
    else if (i === 22 || i === 63 || i === 77) d.push(1); // degraded
    else d.push(0);
  }
  return d;
})();

const STATUS_COLOR: Record<number, string> = {
  0: "#22c55e",
  1: "#f59e0b",
  2: "#ef4444",
};

const METRICS = [
  {
    end: 3000000,
    suffix: "",
    label: "LEADS PROCESSED",
    sub: "monthly capacity per plan",
    speed: "fast" as const,
    formatValue: (n: number) => {
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M+`;
      return n.toLocaleString();
    },
  },
  {
    end: 97,
    suffix: "%",
    label: "DELIVERY RATE",
    sub: "successful engagements",
    speed: "slow" as const,
  },
  {
    end: 2,
    suffix: "%",
    label: "SPAM RATE",
    sub: "lowest in industry",
    speed: "normal" as const,
  },
  {
    end: 200,
    suffix: "",
    label: "CONVERSION RATE",
    sub: "qualified meetings booked",
    speed: "normal" as const,
    formatValue: (n: number) => `${(n / 100).toFixed(2)}%`,
  },
];

export function MetricsSection() {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVis(true);
      },
      { threshold: 0.1 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section id="metrics" ref={ref} className="relative border-t border-[#1e1e1e] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Header */}
        <div
          className={`border-b border-[#1e1e1e] py-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 transition-all duration-500 ${
            vis ? "opacity-100" : "opacity-0"
          }`}
        >
          <div>
            <span className="sys-tag mb-3 block">PERFORMANCE</span>
            <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
              RESULTS YOU
              <br />
              <span
                style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}
              >
                CAN TRACK
              </span>
            </h2>
          </div>
          <div className="text-sm text-[#a8a8a8] italic max-w-sm">
            "Audnix turns cold leads into closed deals—your 24/7 sales machine never takes a beat."
          </div>
        </div>

        {/* Metrics grid — each cell has a fixed min-height and overflow-hidden to prevent bleed */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-b border-[#1e1e1e]">
          {METRICS.map((m, i) => (
            <div
              key={m.label}
              className={`border-r border-[#1e1e1e] last:border-r-0 border-b lg:border-b-0 p-6 lg:p-8 overflow-hidden transition-all duration-500 ${
                vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <AnimCounter 
                end={m.end} 
                suffix={m.suffix} 
                prefix={m.prefix || ""} 
                isVisible={vis}
                speed={m.speed}
                format={m.formatValue}
              />
              <div className="mt-3 font-mono text-[10px] text-[#2196f3] tracking-[0.18em]">
                {m.label}
              </div>
              <div className="mt-1 font-mono text-[10px] text-[#6a9aaa]">
                {m.sub}
              </div>
            </div>
          ))}
        </div>



      </div>
    </section>
  );
}
