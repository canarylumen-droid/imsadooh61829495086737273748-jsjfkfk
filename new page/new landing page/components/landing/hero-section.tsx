"use client";

import { useEffect, useState } from "react";
import { AgentParticleCanvas } from "./agent-particle-canvas";

const VERBS = ["PROSPECT", "QUALIFY", "ENGAGE", "CLOSE", "REPEAT"];



export function HeroSection() {
  const [verbIdx, setVerbIdx] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => { setVisible(true); }, []);

  useEffect(() => {
    const id = setInterval(() => setVerbIdx(v => (v + 1) % VERBS.length), 1140);
    return () => clearInterval(id);
  }, []);



  return (
    <section className="relative overflow-hidden grid-bg pt-[88px] pb-12">
      {/* Particle canvas — right half of hero, full height, behind content */}
      <div className="absolute inset-y-0 right-0 w-full lg:w-[55%] pointer-events-none z-0">
        <AgentParticleCanvas className="w-full h-full" />
      </div>
      {/* Blue radial glow — reinforces canvas area */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{ background: "radial-gradient(ellipse 50% 60% at 80% 50%, rgba(33,150,243,0.06) 0%, transparent 70%)" }}
      />

      <div className="relative z-20 max-w-[1400px] mx-auto px-6 lg:px-12 py-8 w-full min-h-[calc(100vh-88px-48px)] flex flex-col justify-center">



        {/* ── MAIN LAYOUT ─── */}
        <div className="grid lg:grid-cols-[1fr] gap-4 lg:gap-8 items-start">

          {/* LEFT COLUMN */}
          <div>
            {/* Giant headline */}
            <div
              className={`transition-all duration-700 delay-100 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
            >
              {/* Big headline */}
              <h1 className="font-display text-[clamp(2.5rem,9vw,7rem)] leading-[0.88] tracking-tight text-[#f2ede6] uppercase">
                STOP LOSING
              </h1>

              {/* Animated verb */}
              <div className="relative overflow-hidden h-[clamp(2.5rem,9vw,7rem)] leading-[0.88]">
                <h1
                  key={verbIdx}
                  className="font-display text-[clamp(2.5rem,9vw,7rem)] leading-[0.88] tracking-tight text-[#2196f3] uppercase absolute inset-0"
                  style={{ animation: "fade-up 0.1s ease forwards" }}
                >
                  {VERBS[verbIdx]}
                </h1>
              </div>

              <h1 className="font-display text-[clamp(2.5rem,9vw,7rem)] leading-[0.88] tracking-tight uppercase text-[#f2ede6]">
                LEADS
              </h1>
            </div>

            {/* Subtext */}
            <div
              className={`mt-4 transition-all duration-700 delay-300 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <p className="text-sm text-[#c0bbb2] leading-relaxed max-w-md font-black">
                Deploy the only autonomous AI sales rep that prospects, qualifies, handles objections, and books meetings on autopilot. Built for high-ticket closers who never clock out.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 mt-6 w-fit">
                <a
                  href="/signup"
                  className="group inline-flex items-center gap-8 bg-[#2196f3] text-[#050505] font-mono text-xs tracking-widest px-8 py-4 hover:bg-[#42a5f5] transition-colors font-black whitespace-nowrap"
                >
                  START FREE TRIAL
                  <span className="transition-transform group-hover:translate-x-1">→</span>
                </a>
                <a
href="/signup"
              className="group inline-flex items-center gap-8 border border-[#1e1e1e] text-[#d0ccc3] font-mono text-xs tracking-widest px-8 py-4 hover:border-[#2196f3]/40 hover:text-[#2196f3] transition-colors font-black whitespace-nowrap"
            >
              WATCH DEMO
                  <span className="transition-transform group-hover:translate-x-1">→</span>
                </a>
              </div>

              {/* Social proof */}
              <div className="flex items-center gap-3 mt-5">
                <div className="flex -space-x-2">
                  {[
                    "/avatar-1.png",
                    "/avatar-2.png",
                    "/avatar-3.png",
                    "/avatar-4.png"
                  ].map((img, i) => (
                    <img key={i} src={img} alt={`User ${i + 1}`} className="w-7 h-7 rounded-full border-2 border-[#050505] object-cover" />
                  ))}
                </div>
                <span className="font-mono text-[9px] text-[#7a7a7a] font-black">
                  5,000+ agencies · 98% delivery rate
                </span>
              </div>
            </div>
          </div>


        </div>

      </div>

    </section>
  );
}
