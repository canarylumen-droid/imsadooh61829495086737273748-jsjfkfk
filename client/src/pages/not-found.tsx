import { useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Search, ArrowLeft, Sparkles, Globe } from "lucide-react";

export default function NotFound() {
  useEffect(() => {
    // Tell Google not to index this 404 page (Fixes "Soft 404" issues)
    const meta = document.createElement('meta');
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#030303] relative overflow-hidden">
      {/* Dynamic Background Elements */}
      <div className="absolute top-0 left-0 w-full h-full">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-primary/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-500/10 blur-[100px] rounded-full animate-bounce [animation-duration:10000ms]" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 w-full max-w-2xl px-6 text-center"
      >
        <div className="mb-12 inline-flex items-center justify-center w-24 h-24 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-2xl shadow-2xl relative group">
          <div className="absolute inset-0 bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-full" />
          <Globe className="h-10 w-10 text-primary animate-spin-slow ring-offset-4" />
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-7xl md:text-9xl font-black tracking-tightest mb-6 text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40 leading-none"
        >
          404
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-4"
        >
          <h2 className="text-2xl md:text-4xl font-bold text-white tracking-tight">
            Lost in the AI Network?
          </h2>
          <p className="text-muted-foreground/60 text-lg max-w-lg mx-auto font-medium leading-relaxed">
            The resource you're tracking has moved or decohered from our current mapping. Let's redirect your focus.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Link href="/dashboard">
            <Button
              size="lg"
              className="h-14 px-8 rounded-2xl bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-widest text-xs shadow-[0_0_20px_rgba(var(--primary),0.3)] hover:shadow-[0_0_30px_rgba(var(--primary),0.5)] transition-all duration-300"
            >
              <ArrowLeft className="mr-3 h-4 w-4" /> Return to Command Center
            </Button>
          </Link>

          <Link href="/dashboard/prospecting">
            <Button
              variant="outline"
              size="lg"
              className="h-14 px-8 rounded-2xl border-white/10 bg-white/5 backdrop-blur-md hover:bg-white/10 text-white font-black uppercase tracking-widest text-xs transition-all duration-300"
            >
              <Search className="mr-3 h-4 w-4 opacity-50" /> Start New Search
            </Button>
          </Link>
        </motion.div>

        <div className="mt-20 flex items-center justify-center gap-8 opacity-20 grayscale hover:grayscale-0 transition-all duration-700">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Audnix AI Enterprise</span>
          </div>
        </div>
      </motion.div>

      {/* Grid Overlay */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] pointer-events-none" />
    </div>
  );
}
