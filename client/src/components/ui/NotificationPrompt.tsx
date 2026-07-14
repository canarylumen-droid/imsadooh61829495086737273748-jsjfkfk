import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { BellRing, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NotificationPromptProps {
  onAccept: () => void;
  onDecline: () => void;
}

export function NotificationPrompt({ onAccept, onDecline }: NotificationPromptProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ x: 400, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0 }}
          className="fixed bottom-6 right-6 z-[100] w-80 p-6 bg-card/60 backdrop-blur-2xl border border-primary/20 rounded-[2rem] shadow-2xl overflow-hidden group"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary border border-primary/20">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-tight text-foreground line-height-1">Stay Synchronized</h4>
                <p className="text-[10px] font-bold text-primary uppercase tracking-widest">Real-time alerts</p>
              </div>
            </div>
            
            <p className="text-xs text-muted-foreground font-medium mb-6 leading-relaxed">
              Enable desktop notifications to receive immediate intelligence on lead conversions and meeting confirmations.
            </p>
            
            <div className="flex gap-2">
              <Button 
                onClick={onAccept}
                className="flex-1 h-10 rounded-xl bg-primary text-black font-black text-[10px] uppercase tracking-widest hover:bg-primary/90"
              >
                Enable Alerts
              </Button>
              <Button 
                variant="ghost"
                onClick={() => {
                  setIsVisible(false);
                  onDecline();
                }}
                className="px-4 h-10 rounded-xl text-muted-foreground font-bold text-[9px] uppercase tracking-widest hover:bg-muted/50"
              >
                Later
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
