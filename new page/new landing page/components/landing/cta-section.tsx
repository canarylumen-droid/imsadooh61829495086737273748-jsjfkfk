"use client";

import { useEffect, useRef, useState } from "react";

function DotWaveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf: number;
    let t = 0;

    const SPACING = 28;
    const DOT_R   = 1.5;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cols = Math.ceil(canvas.width  / SPACING) + 1;
      const rows = Math.ceil(canvas.height / SPACING) + 1;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const bx = col * SPACING;
          const by = row * SPACING;

          // wave displacement: diagonal propagation
          const wave = Math.sin((col * 0.35) + (row * 0.35) - t * 2.2);
          const dy   = wave * 5;
          const alpha = 0.06 + Math.abs(wave) * 0.22;

          ctx.beginPath();
          ctx.arc(bx, by + dy, DOT_R, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(33,150,243,${alpha.toFixed(3)})`;
          ctx.fill();
        }
      }

      t += 0.016;
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

export function CtaSection() {
  const [vis, setVis] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVis(true); },
      { threshold: 0.2 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  return (
    <section className="relative border-t border-[#1e1e1e]">
      <div
        ref={ref}
        className={`max-w-[1400px] mx-auto px-6 lg:px-12 transition-all duration-700 ${vis ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
      >
        {/* Giant CTA block */}
        <div className="border border-[#1e1e1e] relative overflow-hidden my-12 lg:my-16">
          {/* Dot wave background */}
          <DotWaveCanvas />

          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-16 h-16 border-r border-b border-[#2196f3]/30" />
          <div className="absolute top-0 right-0 w-16 h-16 border-l border-b border-[#2196f3]/30" />
          <div className="absolute bottom-0 left-0 w-16 h-16 border-r border-t border-[#2196f3]/30" />
          <div className="absolute bottom-0 right-0 w-16 h-16 border-l border-t border-[#2196f3]/30" />

          {/* Subtle glow */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse 70% 60% at 50% 100%, rgba(33,150,243,0.04) 0%, transparent 70%)" }}
          />

          <div className="relative z-10 px-8 lg:px-20 py-16 lg:py-24 text-center">
            {/* Status */}
            <div className="flex items-center justify-center gap-3 mb-10">
              <span className="status-pulse w-2 h-2 rounded-full bg-[#22c55e] inline-block" />
              <span className="font-mono text-[11px] tracking-[0.2em] text-[#22c55e]">AUDNIX READY · LET'S GO</span>
            </div>

            {/* Headline */}
            <h2 className="font-display text-[clamp(3.5rem,12vw,10rem)] leading-[0.88] tracking-tight text-[#f2ede6] uppercase mb-4">
              YOUR REVENUE<br />
              <span className="text-[#2196f3]">CONVERSION</span><br />
              STARTS NOW.
            </h2>

            <p className="font-mono text-sm text-[#c8c8c8] mb-12 max-w-lg mx-auto leading-relaxed">
              Join 14,203+ revenue teams using Audnix. Free trial includes unlimited leads for 3 days. No credit card required.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href="/signup"
                className="group inline-flex items-center gap-4 bg-[#2196f3] text-[#050505] font-mono text-sm tracking-widest px-8 py-5 hover:bg-[#42a5f5] transition-colors font-semibold"
              >
                START NOW
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </a>
              <a
                href="/signup"
                className="group inline-flex items-center gap-4 border border-[#2e2e2e] text-[#9a9a9a] font-mono text-sm tracking-widest px-8 py-5 hover:border-[#2196f3]/40 hover:text-[#2196f3] transition-colors"
              >
                TALK TO SALES
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </a>
            </div>

            {/* Social proof row */}
            <div className="flex items-center justify-center gap-8 mt-10 flex-wrap">
              {[
                { v: "14.2K+",  l: "active agents" },
                { v: "3M+",  l: "leads/month" },
                { v: "97%", l: "delivery rate" },
                { v: "2%+",  l: "conversion" },
              ].map(s => (
                <div key={s.l} className="text-center">
                  <div className="font-display text-2xl text-[#2196f3]">{s.v}</div>
                  <div className="font-mono text-[9px] text-[#7a7a7a] tracking-widest">{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
