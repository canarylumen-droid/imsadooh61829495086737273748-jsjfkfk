import { useRef, useState, useEffect } from "react";
import { motion, useMotionTemplate, useMotionValue, AnimatePresence, useSpring } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  MessageSquare,
  Brain,
  Zap,
  CheckCircle2,
  TrendingUp,
  Mail,
  Calendar,
  UserCheck,
  Sparkles as SparklesIcon,
  Server,
  Activity,
  ShieldCheck
} from "lucide-react";
import { Link } from "wouter";
import { Magnetic } from "@/components/ui/Magnetic";

// ============================================
// ANIMATED UI MOCKUP COMPONENT
// Demonstrating "Real Backend" Logic
// ============================================
const AIEngineMockup = () => {
  const [activeStep, setActiveStep] = useState(0);

  const systemLogs = [
    { type: 'intent', text: 'Analyzing Lead Psychographics...', status: 'Verified', color: 'text-cyan-400' },
    { type: 'objection', text: 'Resolving 12+ Active Objections', status: 'Clear', color: 'text-blue-400' },
    { type: 'timing', text: 'Humanizing Sequence Timing', status: 'Active', color: 'text-purple-400' },
    { type: 'conversion', text: 'Securing Calendar Commit...', status: 'Booked', color: 'text-cyan-500' }
  ];

  const threads = [
    { name: "Sarah Miller", status: "Closing Flow", color: "bg-cyan-500/10 text-cyan-400" },
    { name: "James Wilson", status: "Inbound Analysis", color: "bg-blue-500/10 text-blue-400" },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % systemLogs.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative w-full aspect-[4/5] sm:aspect-[4/4] md:aspect-[4/3] rounded-[2rem] border border-border/10 bg-card/40 backdrop-blur-3xl overflow-hidden shadow-2xl p-4 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6 group/mockup"
    >
      <div className="flex items-center justify-between border-b border-border/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Audnix Engine v4.0</h3>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50">System: Operational</p>
          </div>
        </div>
        <div className="px-3 py-1 rounded-full bg-muted border border-border/10 text-[10px] font-mono text-muted-foreground">
          4ms Response
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-hidden">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/20">Live AI Stream</p>
        {systemLogs.map((log, i) => (
          <motion.div
            key={i}
            animate={{ 
              opacity: activeStep === i ? 1 : 0.4,
              x: activeStep === i ? 10 : 0
            }}
            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
              activeStep === i ? 'bg-primary/10 border-primary/20' : 'border-transparent'
            }`}
          >
            <div className="flex items-center gap-3">
              <Activity className={`w-3.5 h-3.5 ${log.color}`} />
              <span className="text-xs font-medium text-foreground/80">{log.text}</span>
            </div>
            <span className={`text-[10px] font-black tracking-widest ${log.color}`}>{log.status}</span>
          </motion.div>
        ))}
      </div>

      <div className="space-y-3 pt-4 border-t border-border/5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/20">Active Deployments</p>
        <div className="grid grid-cols-1 gap-2">
          {threads.map((thread, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border border-border/10">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-primary">{thread.name[0]}</span>
                </div>
                <span className="text-xs font-bold text-foreground">{thread.name}</span>
              </div>
              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${thread.color}`}>{thread.status}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
};

const GridPattern = () => {
  return (
    <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.05] dark:opacity-[0.08]">
      <svg className="h-full w-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-primary/40" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background" />
    </div>
  );
};

export function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { clientX, clientY } = e;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        mouseX.set(clientX - rect.left);
        mouseY.set(clientY - rect.top);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [mouseX, mouseY]);

  const mouseGlow = useMotionTemplate`radial-gradient(800px circle at ${mouseX}px ${mouseY}px, rgba(0, 210, 255, 0.06), transparent 60%)`;

  return (
    <section
      ref={containerRef}
      className="relative min-h-[60vh] md:min-h-[70vh] lg:min-h-[90vh] flex items-center pt-20 pb-12 px-4 overflow-hidden"
    >
      <div className="absolute inset-0 bg-background/95 dark:bg-black/80 pointer-events-none" />
      <GridPattern />

      {/* Ambient Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120vw] h-[120vh] z-0 pointer-events-none opacity-10 dark:opacity-30">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 blur-[150px] rounded-full" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/10 blur-[130px] rounded-full" />
      </div>

      <motion.div className="absolute inset-0 z-[1] pointer-events-none" style={{ background: mouseGlow }} />

          <div className="max-w-7xl mx-auto relative z-20 w-full px-0 sm:px-4">
          <div className="grid lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-16 items-center">
          <div className="flex flex-col items-center lg:items-start text-center lg:text-left space-y-8">
            
            {/* Status Chip */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="inline-flex items-center gap-3 px-6 py-2 rounded-full border border-primary/20 bg-primary/5 backdrop-blur-3xl shadow-xl shadow-primary/10 group cursor-default">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                <span className="text-[10px] uppercase tracking-[0.4em] text-primary font-black group-hover:tracking-[0.5em] transition-all duration-500">
                  14,203 Active Agents · 98% Delivery Rate
                </span>
              </div>
            </motion.div>

            {/* Headline */}
            <div className="space-y-6 max-w-5xl">
              <motion.h1
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2, duration: 1, ease: [0.16, 1, 0.3, 1] }}
                className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black tracking-tighter leading-[0.9] mb-4 text-foreground break-words"
              >
                Stop Losing Leads.<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-500 via-primary to-blue-600 uppercase drop-shadow-[0_0_30px_rgba(var(--primary),0.3)]">
                  AI Closes While You Sleep.
                </span>
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 1 }}
                className="text-sm sm:text-base md:text-lg lg:text-xl text-muted-foreground font-medium tracking-tight max-w-3xl lg:mx-0 mx-auto leading-relaxed"
              >
                 Deploy the only <span className="text-foreground">AI sales agent</span> platform that prospects, qualifies leads, handles objections, and books meetings on autopilot. Stop hiring SDRs and start closing with autonomous outreach automation.
              </motion.p>
            </div>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 1 }}
              className="flex flex-col sm:flex-row gap-3 sm:gap-6 items-center w-full lg:justify-start justify-center"
            >
              <Link href="/auth">
                <Magnetic>
                  <Button
                    ref={buttonRef}
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                    size="lg"
                    className="h-12 sm:h-14 md:h-16 px-6 sm:px-8 md:px-12 rounded-[1rem] md:rounded-[1.5rem] bg-cyan-500 text-black font-black text-sm sm:text-base md:text-lg hover:bg-cyan-400 transition-all shadow-[0_20px_40px_-10px_rgba(6,182,212,0.3)] group uppercase tracking-widest w-full sm:w-auto"
                  >
                    Start Free Trial
                    <ArrowRight className={`ml-3 w-5 h-5 md:w-6 h-6 transition-transform duration-500 ${isHovered ? "translate-x-3" : ""}`} />
                  </Button>
                </Magnetic>
              </Link>
              <Link href="#how-it-works">
                <Magnetic>
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-14 md:h-16 px-6 md:px-10 rounded-[1rem] md:rounded-[1.5rem] border-primary/20 bg-primary/5 hover:bg-primary/10 text-foreground font-black text-sm md:text-lg backdrop-blur-md transition-all uppercase tracking-widest w-full sm:w-auto"
                  >
                    Watch Demo
                  </Button>
                </Magnetic>
              </Link>
            </motion.div>
          </div>

          {/* Mockup Display */}
          <div className="relative mt-20 lg:mt-0 max-w-xl mx-auto lg:ml-auto w-full">
            <div className="absolute inset-0 bg-primary/10 blur-[100px] rounded-full -z-10" />
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.8, duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <AIEngineMockup />
            </motion.div>
          </div>
        </div>

        {/* Trusted By Ribbon */}
        <div className="mt-16 sm:mt-32 border-y border-border/10 bg-muted/5 backdrop-blur-sm w-screen relative left-1/2 -translate-x-1/2 py-6 sm:py-10 overflow-hidden group">
          <div className="absolute inset-0 bg-primary/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />

          <div className="flex items-center gap-16 md:gap-24 animate-marquee whitespace-nowrap">
            {["LUXE PATH", "REPLYFLOW", "ORBIEON", "SAS REC", "KYNOX AI", "LUXE PATH", "REPLYFLOW", "ORBIEON", "SAS REC", "KYNOX AI"].map((brand, i) => (
              <span
                key={`${brand}-${i}`}
                className="text-2xl md:text-3xl font-black tracking-[-0.05em] text-muted-foreground/10 hover:text-primary transition-all duration-300 cursor-none select-none italic"
              >
                {brand}
              </span>
            ))}
          </div>

          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-6 py-2 bg-background border border-primary/30 rounded-full text-[10px] font-black uppercase tracking-[0.3em] text-primary shadow-xl shadow-primary/5">
            Trusted By Top Growth Agencies
          </div>
        </div>
      </div>

      {/* Bottom Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-background to-transparent pointer-events-none z-30" />
    </section>
  );
}
