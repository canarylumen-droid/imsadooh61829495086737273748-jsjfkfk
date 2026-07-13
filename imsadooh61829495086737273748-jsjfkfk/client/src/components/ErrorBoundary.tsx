import React from "react";
import { AlertCircle, RefreshCw, Home, ShieldAlert, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#020202] p-6 relative overflow-hidden">
          {/* AI Gradient Orbs */}
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-primary/10 blur-[150px] rounded-full" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-red-500/5 blur-[120px] rounded-full" />

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 w-full max-w-md"
          >
            <div className="bg-card/30 backdrop-blur-3xl border border-white/5 rounded-[2rem] p-8 shadow-2xl relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500/50 to-transparent opacity-50" />

              <div className="mb-6 flex flex-col items-center text-center">
                <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-6 border border-primary/20 shadow-[0_0_50px_rgba(var(--primary),0.2)]">
                  <ShieldAlert className="h-8 w-8" />
                </div>

                <h2 className="text-2xl font-black text-white tracking-[1.5%] mb-4 uppercase">
                  System Isolation <span className="text-primary italic">Active</span>
                </h2>

                <div className="p-4 rounded-xl bg-black/40 border border-white/5 w-full mb-6 backdrop-blur-md">
                  <p className="text-[10px] font-black uppercase tracking-[0.4em] text-primary/60 mb-2">Platform Diagnostic Report</p>
                  <p className="text-xs font-bold text-muted-foreground/90 uppercase tracking-tight break-words">
                    {this.state.error?.message || "Internal Platform State Error"}
                  </p>
                </div>

                <p className="text-muted-foreground/60 text-sm font-medium leading-[1.4] mb-8">
                  Our autonomous safeguards have successfully isolated a processing anomaly. <br />
                  <span className="text-white italic">Your campaign integrity and data are fully secured.</span>
                </p>

                <div className="flex flex-col sm:flex-row gap-4 w-full">
                  <Button
                    onClick={() => window.location.reload()}
                    className="flex-1 h-12 rounded-xl bg-primary text-black hover:bg-primary/90 font-black uppercase tracking-[0.1em] text-[10px] shadow-[0_0_30px_rgba(var(--primary),0.3)] transition-all duration-500"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Re-Initialize
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => window.location.href = "/"}
                    className="flex-1 h-12 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 text-white font-black uppercase tracking-[0.1em] text-[10px] transition-all duration-500"
                  >
                    <Home className="mr-2 h-4 w-4 opacity-50" /> Emergency Override
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 opacity-20">
                <Sparkles className="h-3 w-3 text-primary" />
                <span className="text-[9px] font-black uppercase tracking-[0.6em] text-white">Audnix AI Safeguard 2.0</span>
              </div>
            </div>
          </motion.div>

          <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.02] pointer-events-none" />
        </div>
      );
    }

    return this.props.children;
  }
}
