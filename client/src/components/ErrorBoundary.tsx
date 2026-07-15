import React from "react";
import { RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
    if (error?.message?.includes("dynamically imported module") || error?.message?.includes("Loading chunk")) {
      window.location.reload();
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex items-center justify-center bg-[#020202] p-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative z-10 w-full max-w-sm text-center"
          >
            <div className="bg-card/30 backdrop-blur-3xl border border-white/5 rounded-2xl p-8 shadow-2xl">
              <div className="mb-6 flex flex-col items-center">
                <div className="h-12 w-12 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 mb-4">
                  <span className="text-xl font-bold">!</span>
                </div>

                <h2 className="text-lg font-bold text-white mb-2">
                  Something went wrong
                </h2>

                <p className="text-muted-foreground/60 text-sm mb-6">
                  An unexpected error occurred. Reloading usually fixes it.
                </p>

                <div className="flex flex-col gap-3 w-full">
                  <Button
                    onClick={() => window.location.reload()}
                    className="h-10 rounded-lg bg-primary text-primary-foreground font-medium text-sm"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" /> Reload Page
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => window.location.href = "/dashboard"}
                    className="h-10 rounded-lg border-white/10 bg-white/5 hover:bg-white/10 text-white font-medium text-sm"
                  >
                    <Home className="mr-2 h-4 w-4" /> Go to Dashboard
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      );
    }

    return this.props.children;
  }
}
