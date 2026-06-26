import { useEffect, useRef, useState } from "react";

const CERTS = ["EMAIL_AUTH", "ENCRYPTION", "ACCESS_CTRL", "DATA_ISOLATION", "AUDIT_LOG"];

const FEATURES = [
  {
    id: "01",
    tag: "DATA ISOLATION",
    title: "SECURE CREDENTIAL STORAGE",
    desc: "Your Gmail, Outlook, and calendar credentials are encrypted end-to-end. Never stored in plain text. Isolated vault per user.",
  },
  {
    id: "02",
    tag: "ACCESS CONTROL",
    title: "PERMISSION SCOPES",
    desc: "Control exactly what Audnix can do with your email. Send only. Read-only replies. Custom scheduling limits. Full transparency.",
  },
  {
    id: "03",
    tag: "COMPLIANCE",
    title: "EMAIL COMPLIANCE",
    desc: "Built-in unsubscribe links. Automatic bounce handling. Sender reputation monitoring. CAN-SPAM friendly practices.",
  },
  {
    id: "04",
    tag: "MONITORING",
    title: "REAL-TIME OVERSIGHT",
    desc: "Monitor every email sent in real time. Review campaigns. Pause anytime. Full audit log of all outreach activity.",
  },
];

export function SecuritySection() {
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
    <section id="security" ref={ref} className="relative border-t border-[#1e1e1e] bg-[#080808] scroll-mt-[88px]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">

        {/* Header row */}
        <div
          className={`border-b border-[#1e1e1e] py-8 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 transition-all duration-500 ${vis ? "opacity-100" : "opacity-0"}`}
        >
          <div>
            <span className="sys-tag mb-3 block">TRUST &amp; SECURITY</span>
            <h2 className="font-display text-6xl lg:text-8xl leading-[0.88] tracking-tight text-[#f2ede6]">
              YOUR EMAIL IS<br />
              <span style={{ WebkitTextStroke: "1px #3a3a3a", color: "transparent" }}>SAFE WITH US</span>
            </h2>
          </div>
          {/* Cert badges */}
          <div className="flex flex-wrap gap-2">
            {CERTS.map((c, i) => (
              <span
                key={c}
                className={`font-mono text-[9px] tracking-widest border border-[#2e2e2e] px-3 py-2 text-[#a0a0a0] hover:border-[#2196f3]/40 hover:text-[#2196f3] transition-all duration-200 cursor-default ${
                  vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
                }`}
                style={{ transitionDelay: `${i * 50 + 200}ms` }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 border-b border-[#1e1e1e]">
          {FEATURES.map((f, i) => (
            <div
              key={f.id}
              className={`border-r border-[#1e1e1e] last:border-r-0 p-6 row-hover transition-all duration-500 group ${
                vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
              }`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              {/* Distinct dot animation per card */}
              <div className="h-10 mb-5 relative overflow-hidden">

                {/* Card 01 — scattered grid blink (opacity driven purely by keyframe) */}
                {i === 0 && (
                  <div className="grid grid-cols-8 gap-[4px] w-full h-full content-start pt-1">
                    {Array.from({ length: 24 }).map((_, d) => (
                      <span
                        key={d}
                        className="block w-[3px] h-[3px] rounded-full bg-[#2196f3]"
                        style={{
                          animationName: "dot-blink",
                          animationDuration: `${1.2 + (d % 4) * 0.4}s`,
                          animationTimingFunction: "step-start",
                          animationIterationCount: "infinite",
                          animationDelay: `${d * 80}ms`,
                          animationFillMode: "both",
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Card 02 — orbit ring (opacity driven purely by keyframe) */}
                {i === 1 && (
                  <div className="relative w-10 h-10">
                    {Array.from({ length: 8 }).map((_, d) => {
                      const angle = (d / 8) * 2 * Math.PI;
                      const r = 16;
                      const x = 20 + r * Math.cos(angle);
                      const y = 20 + r * Math.sin(angle);
                      return (
                        <span
                          key={d}
                          className="absolute block w-[3px] h-[3px] rounded-full bg-[#2196f3]"
                          style={{
                            left: x,
                            top: y,
                            animationName: "dot-blink",
                            animationDuration: "1.6s",
                            animationTimingFunction: "ease-in-out",
                            animationIterationCount: "infinite",
                            animationDelay: `${d * 200}ms`,
                            animationFillMode: "both",
                          }}
                        />
                      );
                    })}
                    <span className="absolute block w-[3px] h-[3px] rounded-full bg-[#2196f3]" style={{ left: 19, top: 19 }} />
                  </div>
                )}

                {/* Card 03 — horizontal scan sweep using scaleX (no inline opacity) */}
                {i === 2 && (
                  <div className="flex items-center gap-[5px] h-full">
                    {Array.from({ length: 14 }).map((_, d) => (
                      <span
                        key={d}
                        className="block w-[3px] h-[3px] rounded-full bg-[#2196f3]"
                        style={{
                          animationName: "dot-scan",
                          animationDuration: "2s",
                          animationTimingFunction: "linear",
                          animationIterationCount: "infinite",
                          animationDelay: `${d * 140}ms`,
                          animationFillMode: "both",
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Card 04 — stepped equalizer bars */}
                {i === 3 && (() => {
                  const heights = [6, 14, 22, 28, 18, 32, 10, 26, 20, 8, 30, 16];
                  return (
                    <div className="flex items-end gap-[3px] h-full pb-0">
                      {heights.map((h, d) => (
                        <span
                          key={d}
                          className="block w-[4px] rounded-sm bg-[#2196f3]"
                          style={{
                            height: h,
                            opacity: 0.3 + (h / 32) * 0.7,
                            animation: `dot-pulse 1.4s ease-in-out infinite`,
                            animationDelay: `${d * 90}ms`,
                          }}
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="flex items-center justify-between mb-4">
                <span className="sys-tag text-[9px]">{f.tag}</span>
                <span className="font-mono text-[9px] text-[#2e2e2e]">{f.id}</span>
              </div>
              <h3 className="font-display text-2xl leading-[0.9] text-[#f2ede6] mb-3 group-hover:text-[#2196f3] transition-colors">
                {f.title}
              </h3>
              <p className="text-sm text-[#a0a0a0] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="py-5 flex items-center justify-between">
          <span className="font-mono text-[10px] text-[#7a7a7a]">
            EVERY EMAIL SENT IS LOGGED, AUDITED, AND FULLY TRANSPARENT
          </span>
          <a href="#" className="font-mono text-[10px] text-[#2196f3] hover:underline tracking-wider">
            COMPLIANCE FAQ →
          </a>
        </div>
      </div>
    </section>
  );
}
